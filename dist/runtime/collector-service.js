import { migrateNativeLayout } from "../config/index.js";
import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { StateStore, processIsAbsent } from "../state/store.js";
import { MailboxClient, MailboxServer } from "../state/mailbox.js";
import { restrict, securePluginNamespace } from "../config/safe-file.js";
import { serviceContext, existingController } from "./service.js";
import { acquireAdmission } from "./admission.js";
import { Collector } from "./collector.js";
import { PanelViews } from "./panel-views.js";
import { inspectorVisible } from "./follow.js";
import { HerdrClient } from "../herdr/client.js";
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/** A single lease owns sampling; views only supply bounded visibility and input. */
export class CollectorHost {
    views;
    collector;
    rpc;
    visibility = new Map();
    queue = Promise.resolve();
    appliedScope;
    constructor(collector, store, rpc) { this.collector = collector; this.rpc = rpc; this.views = new PanelViews(store, rpc); }
    async updateVisibility() {
        const response = await this.rpc.call('session.snapshot'), snapshot = response.snapshot ?? response, records = await this.views.records();
        const live = new Set(records.filter(r => r.open).map(r => r.terminalId));
        for (const terminal of this.visibility.keys())
            if (!live.has(terminal))
                this.visibility.delete(terminal);
        const visible = records.filter(r => r.open).map(r => ({ record: r, state: this.visibility.get(r.terminalId) })).find(v => v.state?.visible && inspectorVisible(snapshot, v.record.terminalId, v.record.paneId));
        this.collector.setVisibleSession(visible?.state?.key, !!visible);
        const subtree = visible?.state?.subtree ?? false;
        if (this.appliedScope !== subtree) {
            this.collector.setScope(subtree);
            this.appliedScope = subtree;
        }
        this.collector.setProcessesExpanded(visible?.state?.expanded ?? false);
    }
    request(op, p = {}) { const result = this.queue.then(() => this.dispatch(op, p)); this.queue = result.catch(() => { }); return result; }
    async dispatch(op, p = {}) {
        if (op === 'maintenance') {
            await this.views.reconcile();
            await this.updateVisibility();
            return { alive: true };
        }
        if (op === 'open-view')
            return this.views.open(p.targetPaneId);
        if (op === 'views')
            return this.views.records();
        if (op === 'view.register')
            return this.views.register(p.paneId, p.terminalId, p.pid);
        if (op === 'view.closed') {
            await this.views.closed(p.terminalId);
            this.visibility.delete(p.terminalId);
            await this.updateVisibility();
            return { closed: true };
        }
        if (op === 'view.poll') {
            const record = (await this.views.records()).find(r => r.terminalId === p.terminalId && r.open);
            if (!record)
                throw new Error('Unowned or closed view');
            if (p.key !== undefined && typeof p.key !== 'string' || typeof p.visible !== 'boolean' || typeof p.subtree !== 'boolean' || typeof p.expanded !== 'boolean')
                throw new Error('Invalid view visibility');
            this.visibility.set(record.terminalId, { key: p.key, visible: p.visible, subtree: p.subtree, expanded: p.expanded });
            await this.updateVisibility();
            return { data: this.collector.data, displayedSessionKey: p.key };
        }
        if (op === 'refresh') {
            await this.views.reconcile();
            await this.collector.refresh();
            return { sessions: this.collector.data.sessions.length, stale: this.collector.data.stale, diagnostics: this.collector.data.diagnostics };
        }
        if (op === 'reload-settings')
            return this.collector.setTabOrder(p.tabOrder, p.nativeGrouping);
        if (op === 'account-report')
            return this.collector.reportAccountLimits(p);
        if (op === 'set-goal') {
            await this.collector.setGoal(p.session, p.objective, p.status);
            return { saved: true };
        }
        if (op === 'toggle-todo') {
            await this.collector.toggleTodo(p.session, p.id);
            return { saved: true };
        }
        if (op === 'terminate-process') {
            const assertVisible = async () => {
                const record = (await this.views.records()).find(r => r.terminalId === p.terminalId && r.open), state = this.visibility.get(p.terminalId);
                if (!record || !state?.visible || state.key !== p.session)
                    throw new Error('Process confirmation view is closed or selection changed');
                const response = await this.rpc.call('session.snapshot');
                if (!inspectorVisible(response.snapshot ?? response, record.terminalId, record.paneId))
                    throw new Error('Process confirmation panel is no longer visible');
            };
            await assertVisible();
            return this.collector.terminateProcess(p.session, p.processTarget, assertVisible);
        }
        if (op === 'focus') {
            await this.collector.focus(p.session);
            return { focused: true };
        }
        if (op === 'message')
            return this.collector.message(p.session, p.id);
        if (op === 'page-messages')
            return this.collector.pageMessages(p.session, p.beforeId);
        if (op === 'page-references' || op === 'page-reference-sources') {
            const session = this.collector.data.sessions.find(s => s.key === p.session);
            const options = op === 'page-references' ? { ...p.options, excludeIds: [...new Set([...(p.options?.excludeIds ?? []), ...(session?.refs ?? []).map(ref => ref.id)])] } : p.options;
            const page = op === 'page-references' ? await this.collector.pageReferences(p.session, options) : await this.collector.pageReferenceSources(p.session, p.targetId, options);
            return { page, data: this.collector.data, contentRevision: this.collector.data.sessions.find(s => s.key === p.session)?.evidence.contentRevision };
        }
        if (op === 'reference-message')
            return this.collector.referenceMessage(p.cursor);
        if (op === 'message-locator') {
            const session = this.collector.data.sessions.find(s => s.key === p.session);
            if (!session)
                throw new Error('Session unavailable');
            return { provider: session.evidence.provider, ref: session.evidence.path ? { kind: 'path', value: session.evidence.path } : { kind: 'id', value: session.evidence.id }, messageId: p.id, providerHomes: this.collector.settings.providerHomes };
        }
        if (op === 'launch') {
            await this.collector.sampleProcesses();
            await this.collector.recordLaunch(p);
            return { registered: true };
        }
        if (op === 'exit-launch') {
            this.collector.ledger.exit(p.id);
            await this.collector.store.write('launches', this.collector.ledger.toJSON());
            return { recorded: true };
        }
        throw new Error('Unknown collector operation');
    }
}
export async function runCollectorService(options = {}) {
    const context = await serviceContext(options), admission = await acquireAdmission(context.stateDir), store = new StateStore(context.serverStateDir);
    const rpc = new HerdrClient(context.endpoint);
    let lease, mailbox, collector, stopping;
    let ready = false;
    let finish = () => { };
    const done = new Promise(resolve => { finish = resolve; });
    let maintenance, maintaining, missed = 0;
    const stop = () => stopping ??= (async () => {
        try {
            clearInterval(maintenance);
            await maintaining?.catch(() => { });
            await mailbox?.close();
            await collector?.close({ clearNative: false });
        }
        finally {
            rpc.close();
            const marker = await store.read('controller');
            if (marker?.token === lease?.token)
                await store.remove('controller');
            await lease?.release();
            await admission.release();
            finish();
        }
    })();
    try {
        await store.init();
        lease = await store.acquire();
        if (context.settings.nativeMode !== 'inspector-only') {
            const migration = await migrateNativeLayout(context.configPath, context.stateDir, context.settings.theme);
            if (migration.changed)
                await rpc.call('server.reload_config');
        }
        collector = new Collector({ rpc, endpoint: context.endpoint, settings: context.settings, stateDir: context.serverStateDir });
        const host = new CollectorHost(collector, store, rpc), global = new StateStore(context.stateDir);
        mailbox = new MailboxServer(context.serverStateDir, lease.token, async (op, p) => {
            if (op === 'ping')
                return { alive: true, ready, stale: collector.data.stale, diagnostics: collector.data.diagnostics, kind: 'collector-service' };
            if (op === 'shutdown') {
                setTimeout(() => void stop(), 50);
                return { stopping: true };
            }
            if ((await global.read('lifecycle'))?.disabled) {
                if (op === 'view.closed')
                    return { closed: true };
                throw new Error('Plugin is deactivated');
            }
            return host.request(op, p);
        });
        await store.write('server', { endpoint: context.endpoint });
        await store.write('controller', { token: lease.token, pid: process.pid, endpoint: context.endpoint, kind: 'collector-service', startedAt: Date.now() });
        await mailbox.start();
        await collector.start();
        ready = !collector.data.stale;
        await admission.release();
        maintenance = setInterval(() => {
            if (maintaining || stopping)
                return;
            maintaining = host.request('maintenance').then(() => { missed = 0; }).catch(() => {
                collector.setVisibleSession(undefined, false);
                // Only this proven owner stops itself; no uncertain foreign PID is killed.
                if (++missed >= 10)
                    setTimeout(() => void stop(), 0);
            }).finally(() => { maintaining = undefined; });
        }, 1000);
        collector.on('data', () => { ready = !collector.data.stale; });
        process.once('SIGTERM', () => void stop());
        process.once('SIGINT', () => void stop());
        await done;
    }
    catch (error) {
        await stop();
        throw error;
    }
}
export async function ensureCollectorService(context) {
    if (process.platform === 'win32' && process.env.HERDR_PLUGIN_ID === 'iob.herdr-prism')
        await securePluginNamespace(context.configDir, context.stateDir);
    let previous = await existingController(context);
    if (previous && processIsAbsent(previous.marker.pid))
        previous = undefined;
    if (previous) {
        const status = await previous.client.request('ping');
        if (status.kind !== 'collector-service')
            throw new Error('Restart Prism through activate to upgrade its legacy collector');
        if (status.ready && !status.stale)
            return previous;
    }
    let child;
    if (!previous) {
        const admission = await acquireAdmission(context.stateDir);
        try {
            const current = await existingController(context);
            if (!current || processIsAbsent(current.marker.pid)) {
                await new StateStore(context.serverStateDir).init();
                const logPath = join(context.serverStateDir, 'collector-start-' + randomUUID() + '.log'), log = await open(logPath, 'wx', 0o600);
                await restrict(logPath);
                try {
                    const entry = fileURLToPath(new URL('../entrypoints/collector' + extname(import.meta.url), import.meta.url));
                    child = spawn(process.execPath, [...(entry.endsWith('.ts') ? ['--experimental-strip-types'] : []), entry, '--config-dir', context.configDir, '--state-dir', context.stateDir, '--config-path', context.configPath, '--socket', context.endpoint], { detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd], env: process.env });
                    child.on('error', () => { });
                    child.unref();
                }
                finally {
                    await log.close();
                }
            }
        }
        finally {
            await admission.release();
        }
    }
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        const owner = await existingController(context);
        if (owner) {
            const status = await owner.client.request('ping').catch(() => undefined);
            if (status?.kind === 'collector-service' && status.ready && !status.stale)
                return owner;
        }
        if (child?.exitCode !== null && child?.exitCode !== undefined && child.exitCode !== 0)
            throw new Error('Collector startup failed; inspect its private collector-start log');
        await sleep(100);
    }
    throw new Error('Shared collector did not become ready; run doctor before retrying');
}
export async function openTabPanel(context, targetPaneId) {
    const owner = await ensureCollectorService(context);
    return new MailboxClient(context.serverStateDir, owner.marker.token, 15000).request('open-view', { targetPaneId });
}
