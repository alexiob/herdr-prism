import { EventEmitter } from 'node:events';
export const lifecycleSubscriptions = ['workspace.created', 'workspace.updated', 'workspace.closed', 'workspace.focused', 'worktree.created', 'worktree.opened', 'worktree.removed', 'tab.created', 'tab.closed', 'tab.focused', 'tab.moved', 'pane.created', 'pane.closed', 'pane.updated', 'pane.focused', 'pane.moved', 'pane.exited', 'pane.agent_detected', 'layout.updated'];
export class SnapshotCache extends EventEmitter {
    snapshot;
    stale = true;
    dirty = false;
    reading;
    refreshTimer;
    reconnectTimer;
    safetyTimer;
    stopped = false;
    backoff = 250;
    tracked = '';
    subscribed = false;
    subscription;
    generation = 0;
    client;
    constructor(client) { super(); this.client = client; client.on('event', this.onEvent); client.on('disconnected', this.onDisconnect); }
    onEvent = (event) => {
        if (this.stopped)
            return;
        if (event.event === 'events_lost') {
            this.stale = true;
            this.emit('stale');
            this.subscribed = false;
            this.generation++;
            this.tracked = '';
            this.dirty = true;
            void this.subscribeAndRefresh().catch(e => this.recover(e));
            return;
        }
        // Metadata publications emit pane_updated. Events invalidate; content joins must compare hashes.
        this.dirty = true;
        if (!this.refreshTimer)
            this.refreshTimer = setTimeout(() => { this.refreshTimer = undefined; void this.refresh().catch(e => this.recover(e)); }, 100);
    };
    onDisconnect = () => { this.stale = true; this.emit('stale'); this.subscribed = false; this.generation++; this.tracked = ''; clearTimeout(this.refreshTimer); this.refreshTimer = undefined; this.recover(new Error('Herdr disconnected')); };
    recover(error) { if (this.stopped)
        return; const announce = !this.stale; this.stale = true; if (announce)
        this.emit('stale'); this.emit('diagnostic', error.message); if (!this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; void this.subscribeAndRefresh().catch(e => this.recover(e)); }, this.backoff);
        this.backoff = Math.min(this.backoff * 2, 10000);
    } }
    async start() { if (this.stopped)
        throw new Error('Snapshot cache closed'); const snapshot = await this.subscribeAndRefresh(); if (this.stopped)
        throw new Error('Snapshot cache closed'); if (!this.safetyTimer)
        this.safetyTimer = setInterval(() => void this.refresh().catch(e => this.recover(e)), 10000); return snapshot; }
    async ensureSubscribed() {
        if (this.stopped)
            throw new Error('Snapshot cache closed');
        while (!this.subscribed) {
            if (!this.subscription) {
                const generation = this.generation;
                this.subscription = this.client.call('events.subscribe', { subscriptions: lifecycleSubscriptions.map(type => ({ type })) }).then(() => { if (!this.stopped && generation === this.generation)
                    this.subscribed = true; }).finally(() => { this.subscription = undefined; });
            }
            await this.subscription;
            if (this.stopped)
                throw new Error('Snapshot cache closed');
        }
    }
    async subscribeAndRefresh() { await this.ensureSubscribed(); const snapshot = await this.refresh(); this.backoff = 250; clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; return snapshot; }
    async refresh() {
        if (this.stopped)
            throw new Error('Snapshot cache closed');
        if (this.reading) {
            this.dirty = true;
            return this.reading;
        }
        this.reading = (async () => {
            let snapshot, readStartedAt;
            do {
                await this.ensureSubscribed();
                this.dirty = false;
                readStartedAt = performance.now();
                const result = await this.client.call('session.snapshot');
                snapshot = result.snapshot ?? result;
                if (!snapshot || !Array.isArray(snapshot.agents) || !Array.isArray(snapshot.panes) || typeof snapshot.protocol !== 'number')
                    throw new Error('Invalid Herdr snapshot');
                if (this.stopped)
                    return snapshot;
                this.snapshot = snapshot;
                this.stale = false;
                const ids = snapshot.agents.map(a => a.pane_id).sort().join(',');
                if (ids !== this.tracked) {
                    const generation = this.generation;
                    await this.client.call('events.subscribe', { subscriptions: [...lifecycleSubscriptions.map(type => ({ type })), ...snapshot.agents.map(a => ({ type: 'pane.agent_status_changed', pane_id: a.pane_id }))] });
                    if (generation === this.generation)
                        this.tracked = ids;
                    else
                        this.dirty = true;
                }
            } while (this.dirty && !this.stopped);
            if (!this.stopped)
                this.emit('snapshot', snapshot, readStartedAt);
            return snapshot;
        })().finally(() => { this.reading = undefined; });
        return this.reading;
    }
    close() { this.stopped = true; this.subscribed = false; this.generation++; clearTimeout(this.refreshTimer); clearTimeout(this.reconnectTimer); clearInterval(this.safetyTimer); this.client.off('event', this.onEvent); this.client.off('disconnected', this.onDisconnect); }
}
