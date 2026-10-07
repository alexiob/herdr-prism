import { EventEmitter } from 'node:events';
import { MailboxClient } from "../state/mailbox.js";
import { ensureCollectorService } from "./collector-service.js";
/** A view never samples or publishes: all operations use the one owner's token. */
export class RemoteCollector extends EventEmitter {
    data = { sessions: [], updatedAt: 0, stale: true, diagnostics: [] };
    context;
    paneId;
    terminalId;
    client;
    timer;
    pending;
    stopped = false;
    key;
    visible = false;
    subtree = false;
    expanded = false;
    failures = 0;
    phase = 'idle';
    constructor(context, paneId, terminalId) { super(); this.context = context; this.paneId = paneId; this.terminalId = terminalId; }
    get displayedSessionKey() { return this.key; }
    get startupPhase() { return this.phase; }
    async start() {
        this.phase = 'ensure-owner';
        const owner = await ensureCollectorService(this.context);
        this.client = new MailboxClient(this.context.serverStateDir, owner.marker.token, 10000, 16 * 1024 * 1024);
        this.phase = 'register';
        await this.client.request('view.register', { paneId: this.paneId, terminalId: this.terminalId, pid: process.pid });
        this.phase = 'initial-poll';
        await this.refresh();
        this.phase = 'running';
        this.timer = setInterval(() => { if (this.pending)
            return; void this.refresh().catch(error => { this.data = { ...this.data, stale: true }; this.emit('diagnostic', error.message); this.emit('data', this.data); if (++this.failures >= 3) {
            clearInterval(this.timer);
            this.emit('disconnected', error);
        } }); }, 500);
    }
    setVisibleSession(key, visible = true) { this.key = key; this.visible = visible; }
    setScope(subtree) { this.subtree = subtree; }
    setProcessesExpanded(expanded) { this.expanded = expanded; }
    async markReady() { if (this.stopped || !this.client)
        throw new Error('View is not running'); return this.client.request('view.ready', { paneId: this.paneId, terminalId: this.terminalId, pid: process.pid }); }
    invalidate() { if (this.client)
        void this.refresh().catch(error => this.emit('diagnostic', error.message)); }
    async refresh() {
        if (this.stopped || !this.client)
            return;
        if (this.pending)
            return this.pending;
        this.pending = (async () => { const response = await this.client.request('view.poll', { terminalId: this.terminalId, key: this.key, visible: this.visible, subtree: this.subtree, expanded: this.expanded }); if (!response.data || !Array.isArray(response.data.sessions))
            throw new Error('Invalid shared dashboard response'); this.failures = 0; if (!this.stopped) {
            this.data = response.data;
            this.emit('data', this.data);
        } })().finally(() => { this.pending = undefined; });
        return this.pending;
    }
    async invoke(op, p) { await this.refresh(); return this.client.request(op, { ...p, terminalId: this.terminalId }); }
    async page(op, p) { const response = await this.invoke(op, p); if (response.data && !this.stopped) {
        this.data = response.data;
        this.emit('data', this.data);
    } return response.page ? { ...response.page, contentRevision: response.contentRevision } : undefined; }
    toggleTodo(...args) { return this.invoke('toggle-todo', { session: args[0], id: args[1] }); }
    processOutput(session, target) { return this.invoke('process-output', { terminalId: this.terminalId, session, processTarget: { key: target.key, owner: target.owner } }); }
    terminateProcess(session, target) { return this.invoke('terminate-process', { terminalId: this.terminalId, session, processTarget: { key: target.key, owner: target.owner } }); }
    focus(...args) { return this.invoke('focus', { session: args[0] }); }
    message(...args) { return this.invoke('message', { session: args[0], id: args[1] }); }
    pageMessages(...args) { return this.invoke('page-messages', { session: args[0], beforeId: args[1] }); }
    pageReferences(...args) { return this.page('page-references', { session: args[0], options: args[1] }); }
    pageReferenceSources(...args) { return this.page('page-reference-sources', { session: args[0], targetId: args[1], options: args[2] }); }
    referenceMessage(...args) { return this.invoke('reference-message', { cursor: args[0] }); }
    async close() { if (this.stopped)
        return; this.stopped = true; clearInterval(this.timer); await this.pending?.catch(() => { }); await this.client?.request('view.closed', { terminalId: this.terminalId }).catch(() => { }); }
}
