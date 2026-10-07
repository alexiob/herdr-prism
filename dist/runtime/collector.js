import { parseAccountLimits, visibleAccountLimits } from "../metrics/account-limits.js";
import { ActivityMonitor, activityState } from "./activity.js";
import { SidebarInventory } from "./sidebar.js";
import { normalizeTabOrder } from "../config/tab-order.js";
import { normalizeNativeGrouping } from "../config/native-grouping.js";
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { buildForest, sessionKey } from "../model/graph.js";
import { ProviderIndex } from "../providers/index.js";
import { TodoList, extractRefs } from "../content/index.js";
import { createSampler } from "../process/sampler.js";
import { ProcessTracker } from "../process/ownership.js";
import { LaunchLedger, processKey } from "../process/ledger.js";
import { reduceUsage, reduceUsageScope } from "../metrics/usage-reducer.js";
import { SampleHistory } from "../metrics/history.js";
import { GitCache } from "../git/cache.js";
import { StateStore, identityName } from "../state/store.js";
import { NativePublisher } from "../native/publisher.js";
import { loadServerIdentity, serverSession } from "./server.js";
function blank(provider, id, cwd, reason = 'Exact local transcript unavailable') { return { id, provider, cwd, messages: [], tools: [], usage: [], goals: [], availability: 'unavailable', reason }; }
function nativeState(agent) { return activityState(agent); }
export function matchesHarness(provider, p) {
    const basename = (v) => v.split(/[\\/]/).at(-1)?.replace(/\.exe$/i, '') ?? '';
    const allowed = provider === 'claude' ? ['claude'] : provider === 'codex' ? ['codex'] : provider === 'pi' ? ['pi', 'pi-coding-agent'] : [];
    const exe = basename(p.argv0 ?? p.argv?.[0] ?? p.name ?? '');
    if (allowed.includes(exe))
        return true;
    if (!['node', 'nodejs', 'bun'].includes(exe))
        return false;
    const script = p.argv?.[1];
    if (!script || script.startsWith('-'))
        return false;
    if (provider === 'pi')
        return allowed.includes(basename(script)) || /[\\/]node_modules[\\/](?:@earendil-works[\\/]pi-coding-agent[\\/]dist[\\/]bundle[\\/]cli\.js|@mariozechner[\\/]pi-coding-agent[\\/]dist[\\/]cli\.js)$/.test(script);
    if (provider === 'claude')
        return /[\\/]@anthropic-ai[\\/]claude-code[\\/]cli\.js$/.test(script);
    return false;
}
function sameOccupant(a, b) { return a.terminal_id === b.terminal_id && a.agent === b.agent && a.agent_session?.kind === b.agent_session?.kind && a.agent_session?.value === b.agent_session?.value; }
function inactive(state) { return state !== undefined && ['idle', 'paused', 'done', 'completed', 'complete', 'error', 'interrupted', 'historical', 'waiting', 'blocked'].includes(state); }
export class Collector extends EventEmitter {
    data = { sessions: [], updatedAt: 0, stale: true, diagnostics: [] };
    index;
    settings;
    store;
    ledger = new LaunchLedger();
    tracker = new ProcessTracker(this.ledger);
    history = new SampleHistory();
    rpc;
    endpoint;
    sampler;
    signalProcess;
    git;
    publisher;
    snapshot;
    lastSample;
    roots = [];
    todos = new Map();
    todoHashes = new Map();
    timer;
    sampleTimer;
    refreshing;
    starting;
    sampling;
    stopped = false;
    subtree = false;
    viewInstalled = false;
    localGoals = new Map();
    savedLaunches = [];
    sampleError;
    publicationHash = '';
    historical = new Map();
    paneOpen = false;
    visibleSession;
    visibleSelections;
    visibilityGeneration = 0;
    sampledGeneration;
    warmup = true;
    processesExpanded = false;
    lastProcessAttemptAt = 0;
    rootProofs = new Map();
    activity;
    sidebar;
    sidebarSupported;
    accountReports = new Map();
    todoHydrated = new Set();
    derived = new Map();
    constructor(options) { super(); this.activity = new ActivityMonitor(options.rpc); this.data.tabOrder = normalizeTabOrder(options.settings.ui?.tabOrder); this.signalProcess = options.signalProcess ?? ((pid, signal) => { process.kill(pid, signal); }); this.endpoint = options.endpoint; this.paneOpen = options.paneOpen === true; this.visibleSession = options.visibleSession; this.rpc = options.rpc; this.settings = options.settings; this.store = new StateStore(options.stateDir); this.index = options.index ?? new ProviderIndex({ codexHome: options.settings.providerHomes.codex, claudeHome: options.settings.providerHomes.claude, piHome: options.settings.providerHomes.pi, maxMessages: 200 }); this.sampler = options.sampler ?? createSampler(); this.git = options.git ?? new GitCache(); this.publisher = new NativePublisher(options.rpc); this.sidebarSupported = process.platform !== 'win32' || !!options.sidebarSampler; this.sidebar = new SidebarInventory(options.rpc, this.git, matchesHarness, options.sidebarSampler, this.sidebarSupported); }
    async init() {
        await this.store.init();
        this.data.server = await loadServerIdentity(this.store, { session: serverSession(this.endpoint) });
        this.publisher.setServerIdentity(this.data.server.id);
        const goals = await this.store.read('goals');
        if (goals && typeof goals === 'object')
            for (const [key, value] of Object.entries(goals))
                if (Array.isArray(value))
                    this.localGoals.set(key, value.filter(g => g && typeof g.objective === 'string').slice(-100));
        const launches = await this.store.read('launches');
        if (Array.isArray(launches))
            this.savedLaunches = launches;
    }
    async start() {
        if (this.starting)
            return this.starting;
        this.starting = (async () => {
            await this.init();
            if (this.stopped)
                return;
            await this.refresh();
            if (this.stopped)
                return;
            await this.sampleProcesses();
            if (this.stopped)
                return;
            this.timer = setInterval(() => void this.refresh(), 1000);
            this.scheduleProcessSample();
        })().finally(() => { this.starting = undefined; });
        return this.starting;
    }
    invalidate() { void this.refresh(); }
    get displayedSessionKey() { return this.visibleSession; }
    /** All displayed views share collection, but retain independent selection and scope. */
    setVisibleSelections(selections) {
        const next = [...new Map(selections.map(value => [JSON.stringify([value.key, value.subtree, value.expanded]), { ...value }])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        if (this.visibleSelections && JSON.stringify(next) === JSON.stringify(this.visibleSelections))
            return;
        const previous = this.observedKeys();
        this.visibleSelections = next;
        this.paneOpen = next.length > 0;
        this.visibleSession = next.find(v => v.key)?.key;
        const observed = this.observedKeys();
        this.visibilityGeneration++;
        this.warmup = !previous.size || ![...observed].some(key => previous.has(key));
        for (const key of observed)
            if (!previous.has(key))
                this.todoHydrated.delete(key);
        this.index.setDetailedRefs([]);
        this.updateResources();
        this.scheduleProcessSample();
        if (this.timer || this.starting)
            void this.refresh().then(() => this.refresh());
    }
    isSessionVisible(key) { return this.paneOpen && (this.visibleSelections ? this.visibleSelections.some(v => v.key === key) : this.visibleSession === key); }
    isSessionInScope(key, owner, subtree) { return owner === key || subtree && this.descendants(key).includes(owner); }
    observedKeys() {
        if (!this.paneOpen)
            return new Set();
        const selections = this.visibleSelections ?? [{ key: this.visibleSession, subtree: this.subtree, expanded: this.processesExpanded }];
        return new Set(selections.flatMap(v => v.key ? [v.key, ...v.subtree ? this.descendants(v.key) : []] : []));
    }
    observedScopes(key) {
        const selections = this.visibleSelections ?? [{ key: this.visibleSession, subtree: this.subtree, expanded: this.processesExpanded }];
        return [...new Set(selections.filter(v => v.key && (v.key === key || !this.visibleSelections && v.subtree && this.descendants(v.key).includes(key))).map(v => v.subtree ? 'subtree' : 'self'))];
    }
    /** Scope is projected for the requesting view; shared data never adopts its preferences. */
    dataForView(key, subtree = false) {
        return { ...this.data, sessions: this.data.sessions.map(session => this.resourceView(session, subtree, key)) };
    }
    /** The foreground inspector owns this gate; finite hooks never open it. */
    setVisibleSession(key, open = true) {
        if (!this.visibleSelections && this.visibleSession === key && this.paneOpen === open)
            return;
        this.visibleSelections = undefined;
        this.visibleSession = key;
        this.paneOpen = open;
        this.visibilityGeneration++;
        this.warmup = true;
        if (open && key)
            this.todoHydrated.delete(key);
        this.index.setDetailedRefs([]);
        this.scheduleProcessSample();
        if (this.timer || this.starting)
            void this.refresh().then(() => this.refresh());
    }
    detailedRef(snapshot, key = this.visibleSession) {
        if (this.visibleSelections) {
            if (!key)
                return;
            const session = this.data.sessions.find(s => s.key === key);
            if (session)
                return { provider: session.evidence.provider, kind: session.evidence.path ? 'path' : 'id', value: session.evidence.path ?? session.evidence.id };
            const agent = snapshot.agents.find(a => a.agent_session?.kind === 'id' && sessionKey(a.agent ?? 'unknown', a.agent_session.value) === key);
            if (agent?.agent_session)
                return { provider: agent.agent ?? 'unknown', kind: agent.agent_session.kind, value: agent.agent_session.value };
            const split = key.indexOf(':');
            if (split > 0)
                return { provider: key.slice(0, split), kind: 'id', value: key.slice(split + 1) };
            return;
        }
        if (!this.paneOpen)
            return;
        if (!this.visibleSession) {
            const focused = snapshot.agents.find(a => a.focused || a.pane_id === snapshot.focused_pane_id) ?? snapshot.agents[0];
            if (focused?.agent_session?.kind === 'id')
                this.visibleSession = sessionKey(focused.agent ?? 'unknown', focused.agent_session.value);
        }
        const previous = this.data.sessions.find(s => s.key === this.visibleSession);
        if (previous)
            return { provider: previous.evidence.provider, kind: previous.evidence.path ? 'path' : 'id', value: previous.evidence.path ?? previous.evidence.id };
        const agent = snapshot.agents.find(a => a.agent_session?.kind === 'id' && sessionKey(a.agent ?? 'unknown', a.agent_session.value) === this.visibleSession);
        if (agent?.agent_session)
            return { provider: agent.agent ?? 'unknown', kind: agent.agent_session.kind, value: agent.agent_session.value };
        if (!this.visibleSession) {
            const first = snapshot.agents.find(a => a.focused) ?? snapshot.agents[0];
            if (first?.agent_session)
                return { provider: first.agent ?? 'unknown', kind: first.agent_session.kind, value: first.agent_session.value };
        }
        const split = this.visibleSession?.indexOf(':') ?? -1;
        if (split > 0)
            return { provider: this.visibleSession.slice(0, split), kind: 'id', value: this.visibleSession.slice(split + 1) };
    }
    setScope(subtree) { this.subtree = subtree; this.updateResources(); this.scheduleProcessSample(); this.emit('data', this.data); }
    setProcessesExpanded(expanded) { if (this.processesExpanded === expanded)
        return; this.processesExpanded = expanded; this.scheduleProcessSample(); }
    scheduleProcessSample() {
        clearTimeout(this.sampleTimer);
        this.sampleTimer = undefined;
        if (this.stopped || !this.timer || !this.paneOpen || !this.visibleSession || this.sampling)
            return;
        const keys = this.observedKeys();
        const observed = this.data.sessions.filter(session => keys.has(session.key));
        if (!observed.length)
            return;
        const idle = observed.every(session => inactive(session.evidence.state));
        const expanded = this.visibleSelections ? this.visibleSelections.some(v => v.expanded) : this.processesExpanded;
        const cadence = expanded ? 1000 : idle ? Math.max(5000, this.settings.sampleIntervalMs) : this.settings.sampleIntervalMs;
        this.sampleTimer = setTimeout(() => { this.sampleTimer = undefined; void this.sampleProcesses(); }, Math.max(1, this.lastProcessAttemptAt + cadence - Date.now()));
    }
    descendants(key) {
        const map = new Map(this.data.sessions.map(s => [s.key, s]));
        const seen = new Set();
        const queue = [...map.get(key)?.children ?? []];
        while (queue.length) {
            const k = queue.pop();
            if (seen.has(k))
                continue;
            seen.add(k);
            queue.push(...map.get(k)?.children ?? []);
        }
        return [...seen];
    }
    resourceView(session, subtree, selectedKey) {
        const view = { ...session }, keys = subtree ? this.descendants(session.key) : [], observed = this.observedKeys().has(session.key);
        if (observed && this.sampledGeneration === this.visibilityGeneration) {
            view.resource = this.tracker.view(session.key, subtree, keys);
            if (this.sampleError)
                view.resource = { ...view.resource, availability: this.lastSample ? 'stale' : 'unavailable', reason: this.sampleError };
        }
        else if (view.resource)
            view.resource = { ...view.resource, availability: 'stale', reason: observed ? 'Awaiting a fresh sample after visibility changed' : 'Updates paused while this session is not shown' };
        const self = reduceUsage(session.evidence.usage, { rates: this.settings.costRates, activeTurnId: session.evidence.activeTurn?.id });
        if (subtree && session.key === selectedKey) {
            const aggregate = reduceUsageScope([session, ...keys.map(k => this.data.sessions.find(s => s.key === k)).filter(Boolean)].map(s => ({ key: s.key, parentKey: s.parentKey, records: s.evidence.usage })), { rates: this.settings.costRates });
            for (const field of ['model', 'contextUsed', 'contextLimit', 'contextPercent', 'generationTokensPerSecond', 'turnTokensPerSecond', 'turnMs', 'generationMs', 'turnUsage']) {
                delete aggregate[field];
                if (self[field] !== undefined)
                    Object.assign(aggregate, { [field]: self[field] });
            }
            if (aggregate.availability === 'known' && keys.some(k => this.data.sessions.find(s => s.key === k)?.evidence.availability === 'stale')) {
                aggregate.availability = 'partial';
                aggregate.diagnostics.push('Descendant usage is cached while its updates are paused');
            }
            view.usage = aggregate;
        }
        else
            view.usage = self;
        view.history = this.history.view(session.key, subtree ? 'subtree' : 'self');
        return view;
    }
    updateResources() {
        for (const session of this.data.sessions)
            Object.assign(session, this.resourceView(session, this.visibleSelections ? false : this.subtree, this.visibleSession));
    }
    async refresh() {
        if (this.stopped)
            return;
        if (this.refreshing)
            return this.refreshing;
        this.refreshing = (async () => {
            try {
                const generation = this.visibilityGeneration;
                const result = await this.rpc.call('session.snapshot');
                const snapshot = structuredClone(result.snapshot ?? result);
                if (!Array.isArray(snapshot.agents) || typeof snapshot.protocol !== 'number')
                    throw new Error('Invalid Herdr snapshot');
                if (this.settings.nativeMode !== 'inspector-only' || this.paneOpen)
                    await this.activity.update(snapshot.agents);
                this.snapshot = snapshot;
                if (this.settings.nativeMode !== 'inspector-only')
                    await this.sidebar.update(snapshot.agents);
                this.index.setActiveRefs(snapshot.agents.flatMap(agent => agent.agent_session ? [{ provider: agent.agent ?? 'unknown', kind: agent.agent_session.kind, value: agent.agent_session.value }] : []));
                const rejected = new Set();
                if (typeof this.index.resolveMetadataCached === 'function') {
                    // Discovery is header-only. A shared Codex daemon can misroute SessionStart
                    // through its first client's inherited HERDR_PANE_ID. Never hydrate that
                    // other project's body merely because the host reported its exact ID.
                    if (this.paneOpen)
                        await this.index.refreshMetadata();
                    for (const agent of snapshot.agents) {
                        if (agent.agent !== 'codex' || !agent.agent_session || agent.agent_session.source !== 'herdr:codex')
                            continue;
                        const header = this.index.resolveMetadataCached('codex', agent.agent_session);
                        const roots = [agent.cwd, agent.foreground_cwd].filter((v) => typeof v === 'string' && !!v);
                        if (!header?.cwd || !roots.length)
                            continue;
                        const canonical = async (value) => { try {
                            return await realpath(value);
                        }
                        catch {
                            return path.resolve(value);
                        } };
                        const origin = await canonical(header.cwd), native = await Promise.all(roots.map(canonical));
                        if (!native.includes(origin))
                            rejected.add(agent.terminal_id);
                    }
                }
                let detailRef = this.detailedRef(snapshot);
                let detailRefs = this.visibleSelections ? this.visibleSelections.flatMap(v => { const ref = v.key ? this.detailedRef(snapshot, v.key) : undefined; return ref ? [ref] : []; }) : detailRef ? [detailRef] : [];
                const refKey = (provider, ref) => sessionKey(provider, this.index.resolveMetadataCached?.(provider, ref)?.id ?? ref.value);
                const accepted = new Set(snapshot.agents.filter(a => !rejected.has(a.terminal_id) && a.agent_session).map(a => refKey(a.agent ?? 'unknown', a.agent_session)));
                const refused = new Set(snapshot.agents.filter(a => rejected.has(a.terminal_id) && a.agent_session).map(a => refKey(a.agent ?? 'unknown', a.agent_session)));
                detailRefs = detailRefs.filter(ref => !refused.has(refKey(ref.provider, ref)) || accepted.has(refKey(ref.provider, ref)));
                if (detailRef && refused.has(refKey(detailRef.provider, detailRef)) && !accepted.has(refKey(detailRef.provider, detailRef)))
                    detailRef = undefined;
                this.index.setDetailedRefs([...new Map(detailRefs.map(ref => [JSON.stringify(ref), ref])).values()]);
                const all = this.paneOpen ? await this.index.refreshSnapshots() : [];
                const known = new Map(all.map(s => [sessionKey(s.provider, s.id), s]));
                const attachments = new Map();
                const active = new Set();
                const nativeOrder = new Map();
                for (const agent of snapshot.agents) {
                    const provider = agent.agent ?? 'unknown';
                    const ref = rejected.has(agent.terminal_id) ? undefined : agent.agent_session;
                    let evidence = ref ? this.index.resolveSnapshotCached(provider, ref) : undefined;
                    if (!evidence && ref?.kind === 'path' && this.paneOpen)
                        evidence = await this.index.resolve(provider, ref);
                    evidence = evidence ? { ...evidence } : blank(provider, ref?.value ?? `pane-${agent.terminal_id}`, agent.foreground_cwd ?? agent.cwd ?? undefined);
                    if (rejected.has(agent.terminal_id))
                        evidence.reason = 'Codex session report belongs to a different working directory. A shared daemon may inherit another pane: launch future Codex sessions with --no-daemon, or correct the Herdr session report.';
                    if (ref?.kind === 'path' && evidence.id === ref.value && !evidence.path)
                        evidence.path = ref.value;
                    evidence.state = nativeState(agent);
                    const pane = snapshot.panes?.find(p => p.terminal_id === agent.terminal_id);
                    const title = agent.terminal_title_stripped ?? pane?.title_stripped ?? pane?.terminal_title_stripped;
                    evidence.title = agent.name ?? (!this.publisher.ownsDisplay(agent) ? agent.display_agent : undefined) ?? evidence.title ?? (typeof title === 'string' ? title : undefined);
                    evidence.cwd = evidence.cwd ?? agent.foreground_cwd ?? agent.cwd ?? undefined;
                    const key = sessionKey(provider, evidence.id);
                    const prior = this.data.sessions.find(s => s.attachment?.terminal_id === agent.terminal_id);
                    if (prior && prior.key === this.visibleSession && (rejected.has(agent.terminal_id) || prior.evidence.id === `pane-${agent.terminal_id}`))
                        this.visibleSession = key;
                    if (rejected.has(agent.terminal_id) && agent.agent_session?.kind === 'id' && !accepted.has(sessionKey(provider, agent.agent_session.value)) && this.visibleSession === sessionKey(provider, agent.agent_session.value))
                        this.visibleSession = key;
                    if (ref?.kind === 'path') {
                        const placeholderKey = sessionKey(provider, ref.value);
                        const placeholder = key !== placeholderKey && this.data.sessions.find(s => s.key === placeholderKey && s.evidence.id === ref.value && s.evidence.path === ref.value && s.evidence.availability === 'unavailable' && (s.attachments ?? (s.attachment ? [s.attachment] : [])).some(a => sameOccupant(a, agent)));
                        if (placeholder) {
                            const goals = this.localGoals.get(placeholderKey);
                            if (goals) {
                                const migrated = new Map(this.localGoals);
                                migrated.set(key, [...goals, ...migrated.get(key) ?? []].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)).slice(-100));
                                migrated.delete(placeholderKey);
                                await this.store.write('goals', Object.fromEntries(migrated));
                                this.localGoals = migrated;
                            }
                            if (this.visibleSession === placeholderKey)
                                this.visibleSession = key;
                            this.historical.delete(placeholderKey);
                            known.delete(placeholderKey);
                            this.todos.delete(placeholderKey);
                            this.todoHashes.delete(placeholderKey);
                        }
                    }
                    if (this.paneOpen && !this.visibleSession && detailRef?.provider === provider && detailRef.kind === ref?.kind && detailRef.value === ref?.value)
                        this.visibleSession = key;
                    if (this.paneOpen && !this.visibleSession && rejected.has(agent.terminal_id) && (agent.focused || agent.pane_id === snapshot.focused_pane_id))
                        this.visibleSession = key;
                    known.set(key, evidence);
                    active.add(key);
                    // Herdr0.9.3 snapshots enumerate agents in workspace/tab/pane order.
                    // Keep the first attachment when the same session has several panes.
                    if (!nativeOrder.has(key))
                        nativeOrder.set(key, nativeOrder.size);
                    attachments.set(key, [...attachments.get(key) ?? [], agent]);
                }
                for (const [key, evidence] of this.historical) {
                    const current = known.get(key);
                    if (!current)
                        known.set(key, { ...evidence });
                    else if (current.reason === 'metadata only; transcript body not loaded' && evidence.messages.length)
                        known.set(key, { ...evidence, state: current.state, title: current.title ?? evidence.title, availability: 'stale', reason: 'Cached details; live updates resume when this session is shown' });
                }
                const include = new Set([...active, ...this.historical.keys()]);
                let changed = true;
                while (changed) {
                    changed = false;
                    for (const [key, evidence] of known) {
                        const parent = evidence.parentId ? sessionKey(evidence.parentProvider ?? evidence.provider, evidence.parentId) : undefined;
                        if ((parent && include.has(parent)) || (include.has(key) && parent && known.has(parent))) {
                            const add = include.has(key) ? parent : key;
                            if (!include.has(add)) {
                                include.add(add);
                                changed = true;
                            }
                        }
                    }
                }
                const previouslyPaneBacked = new Set(this.data.sessions.filter(s => s.attachment || s.historical).map(s => s.key));
                const forest = buildForest([...known].filter(([key]) => include.has(key)).map(([, evidence]) => ({ ...evidence })), nativeOrder);
                const previousSessions = this.data.sessions;
                // Publish parsed body facts before potentially long ACTION/reference history scans.
                // The collecting pane can show its model/messages/usage while enrichment continues.
                if (this.paneOpen && generation === this.visibilityGeneration && !rejected.size) {
                    this.data = { ...this.data, sessions: forest.order.map(node => {
                            const old = previousSessions.find(s => s.key === node.key), attached = attachments.get(node.key) ?? [], historical = !attached.length && previouslyPaneBacked.has(node.key);
                            const evidence = { ...node.evidence, goals: [...node.evidence.goals, ...this.localGoals.get(node.key) ?? []] };
                            if (evidence.provider === 'claude')
                                evidence.accountLimits = visibleAccountLimits(this.accountReports.get(node.key), 'claude', evidence.id, Date.now());
                            if (historical)
                                evidence.state = 'historical';
                            if (!this.isSessionVisible(node.key) && evidence.messages.length) {
                                evidence.availability = 'stale';
                                evidence.reason = 'Cached details; live updates resume when this session is shown';
                            }
                            return { ...node, evidence, historical, attachments: attached, attachment: attached.find(a => a.focused) ?? attached[0], resource: old?.resource, git: old?.git, refs: old?.refs ?? [], refCoverage: old?.refCoverage ?? 'unavailable', refUpdatedAt: old?.refUpdatedAt, todos: old?.todos ?? [], todoStatus: old?.todoStatus ?? 'source_unavailable', todoSourceMessageId: old?.todoSourceMessageId, todoReportedAt: old?.todoReportedAt };
                        }), updatedAt: Date.now(), stale: false };
                    this.updateResources();
                    this.emit('data', this.data);
                }
                const views = [];
                for (const node of forest.order) {
                    node.attachments = attachments.get(node.key) ?? [];
                    node.attachment = node.attachments.find(a => a.focused) ?? node.attachments[0];
                    node.historical = !node.attachment && previouslyPaneBacked.has(node.key);
                    if (node.evidence.provider === 'claude')
                        node.evidence.accountLimits = visibleAccountLimits(this.accountReports.get(node.key), 'claude', node.evidence.id, Date.now());
                    if (node.historical)
                        node.evidence.state = 'historical';
                    this.historical.delete(node.key);
                    this.historical.set(node.key, { ...node.evidence });
                    while (this.historical.size > 512)
                        this.historical.delete(this.historical.keys().next().value);
                    if (this.localGoals.has(node.key))
                        node.evidence.goals = [...node.evidence.goals, ...this.localGoals.get(node.key)];
                    const detailed = generation === this.visibilityGeneration && this.paneOpen && (this.isSessionVisible(node.key) || (!this.visibleSelections && !this.visibleSession && node.evidence.provider === detailRef?.provider && (detailRef.kind === 'path' ? node.evidence.path === detailRef.value : node.evidence.id === detailRef.value)));
                    if (detailed && !this.visibleSession)
                        this.visibleSession = node.key;
                    if (!detailed && node.evidence.messages.length) {
                        node.evidence.availability = 'stale';
                        node.evidence.reason = 'Cached details; live updates resume when this session is shown';
                    }
                    const previous = previousSessions.find(s => s.key === node.key);
                    let list = this.todos.get(node.key);
                    if (!list) {
                        list = new TodoList({ enabled: this.settings.todosEnabled });
                        this.todos.set(node.key, list);
                    }
                    let refs = previous?.refs ?? [];
                    let refCoverage = previous?.refCoverage;
                    let refUpdatedAt = previous?.refUpdatedAt;
                    let git = previous?.git;
                    const canDetail = () => detailed && generation === this.visibilityGeneration && this.paneOpen;
                    if (canDetail()) {
                        if (!this.todoHydrated.has(node.key)) {
                            const persisted = await this.store.read('todo-' + identityName(node.key));
                            const ref = node.evidence.path ? { kind: 'path', value: node.evidence.path } : { kind: 'id', value: node.evidence.id };
                            const history = this.settings.todosEnabled && canDetail() ? await this.index.readTodoState(node.evidence.provider, ref, canDetail) : undefined;
                            if (canDetail()) {
                                list.restore(history ?? persisted);
                                if (history) {
                                    const checks = new Set((persisted?.items ?? []).filter((t) => t.checked === true).map((t) => t.id));
                                    for (const item of list.items)
                                        if (checks.has(item.id) && !item.checked)
                                            list.toggle(item.id);
                                }
                                this.todoHydrated.add(node.key);
                            }
                        }
                        if (canDetail()) {
                            list.setAvailability(node.evidence.availability !== 'unavailable');
                            const cached = this.derived.get(node.key);
                            const unchanged = cached && cached.cwd === node.evidence.cwd && (node.evidence.contentRevision !== undefined ? cached.revision === node.evidence.contentRevision : cached.messages === node.evidence.messages);
                            if (!unchanged) {
                                const previousLast = cached?.messages.at(-1)?.id;
                                if (this.settings.todosEnabled && previousLast && node.evidence.messages.length >= 200 && !node.evidence.messages.some(m => m.id === previousLast) && canDetail()) {
                                    const ref = node.evidence.path ? { kind: 'path', value: node.evidence.path } : { kind: 'id', value: node.evidence.id };
                                    const recovered = await this.index.readTodoState(node.evidence.provider, ref, canDetail);
                                    if (recovered && canDetail()) {
                                        const checks = new Set(list.items.filter(item => item.checked).map(item => item.id));
                                        list.restore(recovered);
                                        for (const item of list.items)
                                            if (checks.has(item.id) && !item.checked)
                                                list.toggle(item.id);
                                    }
                                }
                                if (canDetail())
                                    list.update(node.evidence.messages);
                                if (canDetail())
                                    await this.saveTodo(node.key, list);
                            }
                            else
                                refs = cached.refs ?? [];
                            if (canDetail() && (!unchanged || Date.now() - (cached?.refAttemptAt ?? 0) >= 5000)) {
                                const refAttemptAt = Date.now();
                                if (typeof this.index.readReferences === 'function') {
                                    const ref = node.evidence.path ? { kind: 'path', value: node.evidence.path } : { kind: 'id', value: node.evidence.id };
                                    const history = await this.index.readReferences(node.evidence.provider, ref, canDetail);
                                    if (canDetail()) {
                                        if (history) {
                                            refs = history.refs;
                                            refCoverage = history.limited ? 'partial' : 'session';
                                            refUpdatedAt = history.observedAt;
                                        }
                                        else
                                            refCoverage = 'unavailable';
                                    }
                                }
                                else {
                                    const extracted = await extractRefs(node.evidence.messages, node.evidence.cwd, canDetail);
                                    if (canDetail()) {
                                        refs = extracted;
                                        refCoverage = 'retained';
                                        refUpdatedAt = Date.now();
                                    }
                                }
                                if (canDetail())
                                    this.derived.set(node.key, { revision: node.evidence.contentRevision, messages: node.evidence.messages, cwd: node.evidence.cwd, refs, refAttemptAt });
                            }
                            if (canDetail())
                                git = node.evidence.cwd ? await this.git.get(node.evidence.cwd, { ttlMs: inactive(node.evidence.state) ? 30000 : 5000 }) : undefined;
                        }
                    }
                    else if (git)
                        git = { ...git, availability: 'stale', ageMs: Math.max(0, Date.now() - git.sampledAt), reason: 'Updates paused while another session is shown' };
                    git ??= { availability: 'unavailable', branchState: 'unknown', reason: detailed ? 'Checkout path unavailable' : 'Details load when this session is shown', cwd: node.evidence.cwd ?? '', sampledAt: Date.now(), ageMs: 0 };
                    views.push({ ...node, resource: previous?.resource, refs, refCoverage, refUpdatedAt, todos: list.items.map(t => ({ id: t.id, text: t.text, checked: t.checked, messageId: t.firstMessageId, firstSeenAt: t.firstSeen, latestMessageId: t.latestMessageId, repeated: t.repeated, source: t.source })), todoStatus: list.status, todoSourceMessageId: list.sourceMessageId, todoReportedAt: list.reportedAt, git });
                }
                this.data = { tabOrder: this.data.tabOrder, server: this.data.server, sessions: views, updatedAt: Date.now(), stale: false, diagnostics: [...forest.diagnostics, ...this.index.diagnostics, ...[...this.todos.values()].flatMap(list => list.diagnostics)] };
                this.updateResources();
                this.scheduleProcessSample();
                if (this.settings.nativeMode !== 'inspector-only') {
                    await this.publisher.publish(views.flatMap(s => (s.attachments ?? []).map(a => ({ ...s, attachment: a, resource: this.sidebarSupported ? this.sidebar.resource(a) : !this.paneOpen || this.sampledGeneration !== this.visibilityGeneration || !this.isSessionVisible(s.key) ? { ...this.tracker.view(s.key), availability: 'stale', reason: 'Updates paused while this session is not shown' } : this.sampleError ? { ...this.tracker.view(s.key), availability: this.lastSample ? 'stale' : 'unavailable', reason: this.sampleError } : this.tracker.view(s.key), git: this.sidebar.gitIdentity(a, s.git) }))), Date.now(), views, { grouping: this.settings.ui?.nativeGrouping, tabs: snapshot.tabs, harnessOnly: this.sidebarSupported });
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
                this.diagnostic(error.message);
                this.emit('data', this.data);
            }
        })().finally(() => { this.refreshing = undefined; });
        return this.refreshing;
    }
    reportAccountLimits(payload) {
        if (this.stopped || typeof payload.sessionId !== 'string')
            return { accepted: false };
        const key = sessionKey('claude', payload.sessionId), session = this.data.sessions.find(s => s.key === key && s.attachments?.some(a => a.agent === 'claude' && a.agent_session?.kind === 'id' && a.agent_session.value === payload.sessionId));
        if (!session)
            return { accepted: false };
        const account = parseAccountLimits('claude', payload.sessionId, payload.rateLimits, Date.now(), 'Claude status line');
        this.accountReports.delete(key);
        if (account)
            this.accountReports.set(key, account);
        while (this.accountReports.size > 256)
            this.accountReports.delete(this.accountReports.keys().next().value);
        session.evidence = { ...session.evidence, accountLimits: account };
        this.emit('data', this.data);
        return { accepted: true };
    }
    diagnostic(message) { this.data.diagnostics.push(message); this.data.diagnostics = this.data.diagnostics.slice(-64); this.emit('diagnostic', message); }
    async saveTodo(key, list) {
        const value = list.toJSON(), text = JSON.stringify(value);
        if (this.todoHashes.get(key) !== text) {
            await this.store.write('todo-' + identityName(key), value);
            this.todoHashes.set(key, text);
        }
    }
    async toggleTodo(key, id) {
        const list = this.todos.get(key);
        if (!list || !list.toggle(id))
            throw new Error('To-do item no longer present');
        await this.saveTodo(key, list);
        const session = this.data.sessions.find(s => s.key === key);
        if (session)
            session.todos = list.items.map(t => ({ id: t.id, text: t.text, checked: t.checked, messageId: t.firstMessageId, firstSeenAt: t.firstSeen, latestMessageId: t.latestMessageId, repeated: t.repeated, source: t.source }));
        this.emit('data', this.data);
    }
    async setGoal(key, objective, status = 'active') {
        if (!this.data.sessions.some(s => s.key === key))
            throw new Error('Unknown session');
        if (!objective.trim() || objective.length > 8192)
            throw new Error('Goal must contain 1–8192 characters');
        const records = this.localGoals.get(key) ?? [];
        records.push({ id: `local-${Date.now()}`, objective, status, timestamp: Date.now(), source: 'explicit local action' });
        this.localGoals.set(key, records.slice(-100));
        await this.store.write('goals', Object.fromEntries(this.localGoals));
        await this.refresh();
    }
    async sampleProcesses() {
        if (this.stopped)
            return;
        if (!this.paneOpen || !this.visibleSession || !this.data.sessions.some(s => s.key === this.visibleSession))
            return;
        if (this.sampling)
            return this.sampling;
        this.lastProcessAttemptAt = Date.now();
        const generation = this.visibilityGeneration;
        const observed = this.observedKeys();
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
                const roots = [];
                const batchProcesses = new Map(batch.processes.map(p => [p.pid, p]));
                const liveProofs = new Set();
                // Other harnesses remain attribution exclusions. Their proofs are lightweight,
                // cached identity checks, never background transcript/Git/detail refreshes.
                for (const session of this.data.sessions)
                    for (const attachment of session.attachments ?? (session.attachment ? [session.attachment] : [])) {
                        if (!this.paneOpen || generation !== this.visibilityGeneration)
                            return;
                        const proofKey = JSON.stringify([session.key, attachment.terminal_id]);
                        liveProofs.add(proofKey);
                        const proof = this.rootProofs.get(proofKey);
                        const oldProcess = proof ? batchProcesses.get(proof.root.pid) : undefined;
                        if (!observed.has(session.key) && proof && sameOccupant(proof.attachment, attachment) && proof.bootId === batch.bootId && oldProcess?.startTime === proof.root.startTime && batch.sampledAt - proof.verifiedAt < 30000) {
                            roots.push(proof.root);
                            continue;
                        }
                        this.rootProofs.delete(proofKey);
                        const liveResult = await this.rpc.call('agent.get', { target: attachment.pane_id });
                        if (!this.paneOpen || generation !== this.visibilityGeneration)
                            return;
                        if (!sameOccupant(attachment, liveResult.agent ?? liveResult))
                            continue;
                        const result = await this.rpc.call('pane.process_info', { pane_id: attachment.pane_id });
                        const info = result.process_info ?? result;
                        const foreground = (info.foreground_processes ?? []);
                        const candidates = foreground.filter(p => matchesHarness(session.evidence.provider, p));
                        const process = candidates.map(p => batchProcesses.get(p.pid)).find(Boolean);
                        if (!process)
                            continue;
                        const root = { sessionKey: session.key, pid: process.pid, startTime: process.startTime };
                        roots.push(root);
                        this.rootProofs.set(proofKey, { attachment: { ...attachment }, root, bootId: batch.bootId, verifiedAt: batch.sampledAt });
                    }
                for (const key of this.rootProofs.keys())
                    if (!liveProofs.has(key))
                        this.rootProofs.delete(key);
                if (!this.paneOpen || generation !== this.visibilityGeneration)
                    return;
                this.roots = roots;
                this.tracker.update(batch, roots, { resetCpuBaseline: this.warmup });
                this.warmup = false;
                this.sampledGeneration = generation;
                this.updateResources();
                for (const session of this.data.sessions.filter(s => observed.has(s.key))) {
                    for (const scope of this.observedScopes(session.key)) {
                        const resource = this.tracker.view(session.key, scope === 'subtree', scope === 'subtree' ? this.descendants(session.key) : []);
                        this.history.add(session.key, scope, { at: batch.sampledAt, cpuPercent: resource.cpuPercent, memoryBytes: resource.memoryBytes, gap: resource.availability === 'unavailable' });
                    }
                    session.history = this.history.view(session.key, this.visibleSelections ? 'self' : this.subtree ? 'subtree' : 'self');
                }
                this.emit('data', this.data);
            }
            catch (error) {
                this.sampleError = error.message;
                for (const session of this.data.sessions) {
                    if (session.resource)
                        session.resource = { ...session.resource, availability: 'stale', reason: error.message };
                    if (observed.has(session.key))
                        for (const scope of this.observedScopes(session.key))
                            this.history.add(session.key, scope, { at: Date.now(), gap: true });
                }
                this.diagnostic('Process sample: ' + error.message);
                this.emit('data', this.data);
            }
        })().finally(() => { this.sampling = undefined; this.scheduleProcessSample(); });
        return this.sampling;
    }
    /** Read the retained owner terminal, never another process's stdout pipe. */
    async processOutput(sessionKey, target, assertVisible, subtree = this.subtree) {
        if (!target || typeof target.key !== 'string' || target.key.length > 4096 || typeof target.owner !== 'string')
            return;
        const generation = this.visibilityGeneration, current = () => !this.stopped && this.isSessionVisible(sessionKey) && generation === this.visibilityGeneration;
        const inScope = () => this.isSessionInScope(sessionKey, target.owner, subtree);
        if (!current() || !inScope())
            return;
        await assertVisible();
        if (!current())
            return;
        if (!this.lastSample || this.sampledGeneration !== generation || Date.now() - this.lastSample.sampledAt > 5000)
            await this.sampleProcesses();
        if (!current() || !inScope() || this.sampleError || this.sampledGeneration !== generation)
            return;
        const selected = this.tracker.view(target.owner).processes.find(p => p.key === target.key && p.owner === target.owner && p.availability !== 'unavailable');
        if (!selected)
            return;
        const unavailable = (reason) => ({ availability: 'unavailable', scope: 'shared-terminal', pid: selected.pid, owner: target.owner, processKey: target.key, capturedAt: Date.now(), reason });
        const proofs = [...this.rootProofs.values()].filter(p => p.root.sessionKey === target.owner && p.bootId === this.lastSample?.bootId);
        const sampled = new Map(this.lastSample.processes.map(p => [p.pid, p])), ancestors = new Set();
        let ancestor = sampled.get(selected.pid);
        while (ancestor && !ancestors.has(ancestor.pid)) {
            ancestors.add(ancestor.pid);
            ancestor = ancestor.ppid === undefined ? undefined : sampled.get(ancestor.ppid);
        }
        const proof = proofs.find(p => ancestors.has(p.root.pid) && sampled.get(p.root.pid)?.startTime === p.root.startTime);
        if (!proof)
            return unavailable('No verified harness terminal owns this process output');
        const live = async () => {
            if (!current() || !inScope())
                return false;
            const response = await this.rpc.call('agent.get', { target: proof.attachment.pane_id });
            if (!current() || !sameOccupant(proof.attachment, response.agent ?? response))
                return false;
            const reply = await this.rpc.call('pane.process_info', { pane_id: proof.attachment.pane_id }), info = reply.process_info ?? reply;
            return current() && (info.foreground_processes ?? []).some((p) => p.pid === proof.root.pid && matchesHarness(proof.attachment.agent ?? 'unknown', p));
        };
        try {
            if (!await live())
                return;
            await assertVisible();
            if (!current())
                return;
            const response = await this.rpc.call('pane.read', { pane_id: proof.attachment.pane_id, source: 'recent_unwrapped', lines: 200, format: 'text', strip_ansi: true }), read = response.read;
            if (!current())
                return;
            await assertVisible();
            if (!await live())
                return;
            if (!read || read.pane_id !== proof.attachment.pane_id || read.source !== 'recent_unwrapped' || read.format !== 'text' || typeof read.text !== 'string')
                return unavailable('Herdr did not provide a supported terminal capture');
            const encoded = Buffer.from(read.text), truncated = encoded.length > 65536;
            let start = Math.max(0, encoded.length - 65536);
            // Preserve the byte cap without decoding a partial UTF-8 code point.
            while (start < encoded.length && (encoded[start] & 0xc0) === 0x80)
                start++;
            let text = truncated ? encoded.subarray(start).toString('utf8') : read.text;
            // A retained snapshot is display text, never terminal control sequences.
            text = text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
            return { availability: 'known', scope: 'shared-terminal', pid: selected.pid, owner: target.owner, processKey: target.key, capturedAt: Date.now(), paneId: proof.attachment.pane_id, terminalId: proof.attachment.terminal_id, source: 'recent_unwrapped', text, truncated };
        }
        catch (error) {
            if (current())
                return unavailable(error.message.slice(0, 500));
        }
    }
    /** A confirmed view request operates on this server, never the viewer's OS. */
    async terminateProcess(sessionKey, target, assertVisible, subtree = this.subtree) {
        if (!target || typeof target.key !== 'string' || target.key.length > 4096 || typeof target.owner !== 'string')
            throw new Error('Invalid process target');
        const generation = this.visibilityGeneration;
        const current = () => !this.stopped && this.isSessionVisible(sessionKey) && generation === this.visibilityGeneration;
        const inScope = () => this.isSessionInScope(sessionKey, target.owner, subtree);
        if (!current() || !inScope())
            throw new Error('Process view is closed or selection changed');
        const selected = this.dataForView(sessionKey, subtree).sessions.find(s => s.key === sessionKey)?.resource?.processes.find(p => p.key === target.key && p.owner === target.owner);
        if (!selected || selected.availability === 'unavailable')
            throw new Error('Process is no longer readable or owned in this view');
        // Wait out any older scan, then obtain fresh ownership/root occupant proofs.
        await this.sampling;
        if (!current())
            throw new Error('Process view changed');
        await this.sampleProcesses();
        if (!current() || !inScope() || this.sampleError || this.sampledGeneration !== generation)
            throw new Error('Fresh process validation unavailable');
        await assertVisible();
        if (!current())
            throw new Error('Process view changed');
        const scanStarted = Date.now();
        const batch = await this.sampler.sample();
        // A slow scan must not let a closed/background panel authorize the signal.
        await assertVisible();
        for (const proof of this.rootProofs.values())
            if (proof.root.sessionKey === target.owner) {
                const response = await this.rpc.call('agent.get', { target: proof.attachment.pane_id });
                if (!sameOccupant(proof.attachment, response.agent ?? response))
                    throw new Error('Agent owner changed or ended');
            }
        if (!current() || !inScope())
            throw new Error('Process view changed');
        if (Date.now() - scanStarted > 2000 || batch.sampledAt < scanStarted - 1000 || Date.now() - batch.sampledAt > 2000 || batch.sampledAt > Date.now() + 1000)
            throw new Error('Process validation took too long; retry');
        // OS birth and Herdr occupant/view proofs cannot be locked together.
        // Node's portable signal API remains PID based, not an atomic birth lock.
        const live = batch.processes.find(p => p.pid === selected.pid);
        if (!live || live.availability === 'unavailable' || processKey(batch.bootId, live.pid, live.startTime) !== target.key)
            throw new Error('Process ended, became unreadable, or its PID was reused');
        const root = this.roots.find(r => r.sessionKey === target.owner && batch.processes.some(p => p.pid === r.pid && p.startTime === r.startTime && p.availability !== 'unavailable'));
        if (!root) {
            const byPid = new Map(batch.processes.map(p => [p.pid, p])), seen = new Set();
            let ancestor = live, launchOwner;
            while (ancestor && !seen.has(ancestor.pid)) {
                seen.add(ancestor.pid);
                if (ancestor.availability === 'unavailable')
                    break;
                launchOwner = this.ledger.owner(batch, ancestor.pid, ancestor.startTime);
                if (launchOwner)
                    break;
                const parent = byPid.get(ancestor.ppid ?? -1);
                if (parent && BigInt(parent.startTime) > BigInt(ancestor.startTime))
                    break;
                ancestor = parent;
            }
            if (launchOwner !== target.owner)
                throw new Error('Agent owner changed or ended');
        }
        this.tracker.update(batch, this.roots);
        const owned = this.tracker.view(target.owner).processes.find(p => p.key === target.key && p.owner === target.owner);
        if (!owned || owned.availability === 'unavailable')
            throw new Error('Process ownership changed');
        if (live.pid <= 1 || live.pid === process.pid || live.pid === process.ppid)
            throw new Error('Prism cannot terminate its collector or server process');
        try {
            this.signalProcess(live.pid, 'SIGTERM');
        }
        catch (error) {
            const code = error.code;
            throw new Error(code === 'ESRCH' ? 'Process already ended' : code === 'EPERM' || code === 'EACCES' ? 'Permission denied terminating process' : 'Termination failed: ' + error.message);
        }
        this.lastSample = batch;
        this.updateResources();
        this.emit('data', this.data);
        return { requested: true, pid: live.pid, signal: 'SIGTERM', platform: process.platform };
    }
    setTabOrder(value, grouping = this.settings.ui?.nativeGrouping) { const order = normalizeTabOrder(value), nativeGrouping = normalizeNativeGrouping(grouping); this.settings.ui = { ...this.settings.ui, tabOrder: order, nativeGrouping }; this.data.tabOrder = order; this.emit('data', this.data); return { reloaded: true, tabOrder: [...order] }; }
    async focus(key) {
        const session = this.data.sessions.find(s => s.key === key);
        const expected = session?.attachment;
        if (!expected)
            throw new Error('Agent has no live pane; conversation remains readable');
        const result = await this.rpc.call('agent.get', { target: expected.pane_id });
        const live = result.agent ?? result;
        if (!sameOccupant(expected, live))
            throw new Error('Agent occupant changed or ended');
        await this.rpc.call('agent.focus', { target: expected.pane_id });
    }
    async message(key, id) {
        const session = this.data.sessions.find(s => s.key === key);
        if (!session)
            return;
        const current = session.evidence.messages.find(m => m.id === id);
        if (current)
            return current;
        const ref = session.evidence.path ? { kind: 'path', value: session.evidence.path } : { kind: 'id', value: session.evidence.id };
        return this.index.readMessage(session.evidence.provider, ref, id);
    }
    async pageMessages(key, beforeId) {
        const session = this.data.sessions.find(s => s.key === key);
        if (!session)
            return [];
        const ref = session.evidence.path ? { kind: 'path', value: session.evidence.path } : { kind: 'id', value: session.evidence.id };
        return this.index.page(session.evidence.provider, ref, { beforeId, limit: 200 });
    }
    async pageReferences(key, options = {}) { const generation = this.visibilityGeneration, current = () => !this.stopped && this.isSessionVisible(key) && generation === this.visibilityGeneration; const session = this.data.sessions.find(s => s.key === key); if (!session || !current())
        return; const ref = session.evidence.path ? { kind: 'path', value: session.evidence.path } : { kind: 'id', value: session.evidence.id }; return this.index.pageReferences(session.evidence.provider, ref, options, current); }
    async pageReferenceSources(key, targetId, options = {}) { const generation = this.visibilityGeneration, current = () => !this.stopped && this.isSessionVisible(key) && generation === this.visibilityGeneration; const session = this.data.sessions.find(s => s.key === key); if (!session || !current())
        return; const ref = session.evidence.path ? { kind: 'path', value: session.evidence.path } : { kind: 'id', value: session.evidence.id }; return this.index.pageReferenceSources(session.evidence.provider, ref, targetId, options, current); }
    async referenceMessage(cursor) { const key = sessionKey(cursor.provider, cursor.sessionId), generation = this.visibilityGeneration, current = () => !this.stopped && this.isSessionVisible(key) && generation === this.visibilityGeneration; if (!current())
        return; return this.index.readReferenceMessage(cursor, current); }
    async recordLaunch(record) {
        if (!this.data.sessions.some(s => s.key === record.sessionKey))
            throw new Error('Unknown session; launch cannot take process ownership');
        if (!this.lastSample)
            throw new Error('No validated process sample');
        this.ledger.add(record, this.lastSample);
        await this.store.write('launches', this.ledger.toJSON());
    }
    async close(options = {}) {
        this.stopped = true;
        clearInterval(this.timer);
        clearInterval(this.sampleTimer);
        await this.sidebar.close();
        this.git.close();
        await this.starting?.catch(() => { });
        await this.refreshing;
        await this.sampling;
        if (options.clearNative !== false)
            await this.publisher.clear(this.data.sessions);
        this.index.close();
        await this.sampler.close();
    }
}
