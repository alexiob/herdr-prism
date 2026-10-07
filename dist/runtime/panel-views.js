import { StateStore, identityName, processIsAbsent } from "../state/store.js";
import { openPanel } from "./actions.js";
import { join } from 'node:path';
export const DEFAULT_PANEL_COLUMNS = 60;
export function panelViewStore(serverStateDir, tabId, targetTerminalId) { return new StateStore(join(serverStateDir, 'views', identityName(targetTerminalId ? JSON.stringify([tabId, targetTerminalId]) : tabId))); }
/** Herdr can start the child before returning its authoritative open identity. */
export async function waitForPanelRecord(store, own, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    do {
        const rows = await store.read('views');
        if (rows !== undefined && (!Array.isArray(rows) || rows.length > 128))
            throw new Error('Invalid panel ownership records');
        const record = rows?.find(row => row.terminalId === own.terminalId);
        if (record && (record.paneId !== own.paneId || record.tabId !== own.tabId || !record.open))
            throw new Error('Inspector binding identity changed');
        if (record && typeof record.targetTerminalId === 'string' && record.targetTerminalId)
            return record;
        if (Date.now() >= deadline)
            break;
        await new Promise(resolve => setTimeout(resolve, Math.min(25, deadline - Date.now())));
    } while (Date.now() <= deadline);
    throw new Error('Inspector binding did not become available');
}
/** A collector being ready says nothing about its independently launched frontends. */
export async function requestedViewsReady(store, rpc, requested) {
    if (!requested.length)
        return true;
    const records = await new PanelViews(store, rpc).records();
    const selected = requested.map(own => records.find(record => record.terminalId === own.terminalId && record.paneId === own.paneId));
    if (selected.some(record => !record?.open || record.ready !== true || !Number.isSafeInteger(record.pid) || record.pid < 1 || processIsAbsent(record.pid)))
        return false;
    const response = await rpc.call('session.snapshot'), panes = (response.snapshot ?? response).panes;
    return selected.every(record => panes.some((pane) => pane.pane_id === record.paneId && pane.terminal_id === record.terminalId && pane.tab_id === record.tabId));
}
/** Only authoritative open responses and exact terminal identities own a view. */
export class PanelViews {
    store;
    rpc;
    widths = new Map();
    constructor(store, rpc) { this.store = store; this.rpc = rpc; }
    async current(pane) { const owner = await this.store.read('controller'); if (owner?.kind === 'collector-service')
        await this.store.write('controller', { ...owner, paneId: pane.pane_id, terminalId: pane.terminal_id }); }
    geometry(snapshot, record) {
        const layout = snapshot.layouts?.find((value) => value.tab_id === record.tabId), own = layout?.panes?.find((p) => p.pane_id === record.paneId)?.rect;
        const target = snapshot.panes?.find((p) => p.terminal_id === record.targetTerminalId), native = layout?.panes?.find((p) => p.pane_id === target?.pane_id)?.rect;
        if (!own || !native || !Number.isSafeInteger(own.width) || own.width < 1)
            return;
        const contains = (outer, inner) => outer && inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
        const split = layout.splits?.filter((value) => value.direction === 'right' && Number.isFinite(value.ratio) && contains(value.rect, own) && contains(value.rect, native)).sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
        if (!split || !Number.isSafeInteger(split.rect.width) || split.rect.width < 1)
            return;
        return { width: own.width, ratio: split.ratio, regionWidth: split.rect.width, splitId: split.id };
    }
    /** Only a changed split ratio at the same region width is a user pane resize.
     * Client/window and outer-layout resizes must not overwrite the saved desired width. */
    async observeWidths(snapshot) {
        const records = await this.records(), live = new Set(records.filter(r => r.open).map(r => r.terminalId));
        for (const terminal of this.widths.keys())
            if (!live.has(terminal))
                this.widths.delete(terminal);
        for (const record of records.filter(r => r.open && r.targetTerminalId)) {
            const geometry = this.geometry(snapshot, record);
            if (!geometry)
                continue;
            const previous = this.widths.get(record.terminalId);
            this.widths.set(record.terminalId, geometry);
            if (previous && geometry.regionWidth === previous.regionWidth && geometry.splitId === previous.splitId && Math.abs(geometry.ratio - previous.ratio) > 0.00001 && geometry.width !== previous.width) {
                const store = panelViewStore(this.store.dir, record.tabId, record.targetTerminalId);
                await store.write('panel-size', { columns: geometry.width, custom: true });
            }
        }
    }
    async sizePanel(record, nativePaneId) {
        const response = await this.rpc.call('session.snapshot'), snapshot = response.snapshot ?? response, geometry = this.geometry(snapshot, record);
        if (!geometry)
            return;
        const store = panelViewStore(this.store.dir, record.tabId, record.targetTerminalId), saved = await store.read('panel-size');
        const requested = Number.isSafeInteger(saved?.columns) && saved.columns >= 20 && saved.columns <= 1000 ? saved.columns : DEFAULT_PANEL_COLUMNS;
        const maximum = saved?.custom === true ? geometry.regionWidth - 32 : Math.min(geometry.regionWidth - 32, Math.floor(geometry.regionWidth * 0.45));
        const columns = Math.max(Math.min(20, Math.floor(geometry.regionWidth * 0.4)), Math.min(requested, maximum));
        const exported = await this.rpc.call('layout.export', { pane_id: record.paneId });
        const find = (node, path = []) => {
            if (!node || node.type !== 'split')
                return;
            if (node.direction === 'right' && node.first?.type === 'pane' && node.first.pane_id === nativePaneId && node.second?.type === 'pane' && node.second.pane_id === record.paneId)
                return { path, ratio: node.ratio };
            return find(node.first, [...path, false]) ?? find(node.second, [...path, true]);
        };
        const split = find(exported.layout?.root);
        if (!split)
            throw new Error('New Prism panel no longer shares its native target split');
        const ratio = Math.max(0.1, Math.min(0.9, split.ratio + (geometry.width - columns) / geometry.regionWidth));
        await this.rpc.call('layout.set_split_ratio', { pane_id: record.paneId, path: split.path, ratio });
        if (!saved)
            await store.write('panel-size', { columns: requested, custom: false });
        const updated = await this.rpc.call('session.snapshot'), measured = this.geometry(updated.snapshot ?? updated, record);
        if (measured)
            this.widths.set(record.terminalId, measured);
    }
    async records() {
        const rows = await this.store.read('views') ?? [];
        if (!Array.isArray(rows) || rows.length > 128 || rows.some(r => !r || typeof r.tabId !== 'string' || typeof r.paneId !== 'string' || typeof r.terminalId !== 'string' || typeof r.open !== 'boolean' || r.targetTerminalId !== undefined && typeof r.targetTerminalId !== 'string' || r.ready !== undefined && typeof r.ready !== 'boolean'))
            throw new Error('Invalid panel ownership records');
        return rows;
    }
    async open(targetPaneId) {
        const response = await this.rpc.call('session.snapshot'), snapshot = response.snapshot ?? response;
        const target = snapshot.panes?.find((p) => p.pane_id === (targetPaneId ?? snapshot.focused_pane_id));
        if (!target?.tab_id || typeof target.terminal_id !== 'string')
            throw new Error('No target agent terminal for Prism');
        const records = await this.records();
        const targetView = records.find(r => r.terminalId === target.terminal_id);
        const targetTerminalId = targetView?.targetTerminalId ?? target.terminal_id;
        const current = records.find(r => r.open && (r.terminalId === target.terminal_id || r.targetTerminalId === targetTerminalId) && snapshot.panes.some((p) => p.terminal_id === r.terminalId && p.tab_id === target.tab_id));
        if (current) {
            const pane = snapshot.panes.find((p) => p.terminal_id === current.terminalId);
            await this.current(pane);
            return this.rpc.call('plugin.pane.focus', { pane_id: pane.pane_id });
        }
        if (records.length >= 128 && !records.some(r => r.targetTerminalId === targetTerminalId)) {
            const old = records.findIndex(r => !r.open);
            if (old < 0)
                throw new Error('Prism panel limit reached');
            records.splice(old, 1);
        }
        const nativeTarget = targetView ? snapshot.panes.find((p) => p.terminal_id === targetTerminalId) : target;
        if (!nativeTarget)
            throw new Error('Bound native target terminal is unavailable');
        const opened = await openPanel(this.rpc, { targetPaneId: nativeTarget.pane_id });
        const owned = opened.plugin_pane;
        if (owned?.plugin_id !== 'iob.herdr-prism' || owned.entrypoint !== 'inspector' || typeof owned.pane?.pane_id !== 'string' || typeof owned.pane?.terminal_id !== 'string')
            throw new Error('Invalid dashboard ownership response');
        const record = { tabId: target.tab_id, paneId: owned.pane.pane_id, terminalId: owned.pane.terminal_id, targetTerminalId, open: true, ready: false };
        await this.store.write('views', [...records.filter(r => r.targetTerminalId !== targetTerminalId), record]);
        await this.current(owned.pane);
        await this.sizePanel(record, nativeTarget.pane_id);
        return opened;
    }
    async register(paneId, terminalId, pid) {
        if (typeof paneId !== 'string' || typeof terminalId !== 'string' || !Number.isSafeInteger(pid) || pid < 1)
            throw new Error('Invalid view registration');
        const rows = await this.records(), record = rows.find(r => r.terminalId === terminalId);
        if (!record?.open)
            throw new Error('Unowned or closed view terminal');
        const response = await this.rpc.call('session.snapshot'), pane = (response.snapshot ?? response).panes.find((p) => p.terminal_id === terminalId && p.pane_id === paneId);
        if (!pane || pane.tab_id !== record.tabId)
            throw new Error('View identity changed');
        record.pid = pid;
        record.paneId = paneId;
        record.ready = false;
        await this.store.write('views', rows);
        return record;
    }
    async ready(paneId, terminalId, pid) {
        const rows = await this.records(), record = rows.find(r => r.terminalId === terminalId);
        if (!record?.open || record.paneId !== paneId || !Number.isSafeInteger(pid) || pid < 1 || record.pid !== pid || processIsAbsent(pid))
            throw new Error('View readiness requires its live registration');
        const response = await this.rpc.call('session.snapshot'), pane = (response.snapshot ?? response).panes.find((p) => p.terminal_id === terminalId && p.pane_id === paneId && p.tab_id === record.tabId);
        if (!pane)
            throw new Error('View readiness identity changed');
        record.ready = true;
        await this.store.write('views', rows);
        return { ready: true };
    }
    async captureWidths() { const response = await this.rpc.call('session.snapshot'); await this.observeWidths(response.snapshot ?? response); }
    async closed(terminalId) { await this.captureWidths(); const rows = await this.records(); const row = rows.find(r => r.terminalId === terminalId); if (row) {
        row.open = false;
        row.ready = false;
        await this.store.write('views', rows);
    } }
    async reconcile() { const rows = await this.records(), response = await this.rpc.call('session.snapshot'), panes = (response.snapshot ?? response).panes; let changed = false; for (const row of rows)
        if (row.open && !panes.some((p) => p.terminal_id === row.terminalId)) {
            row.open = false;
            row.ready = false;
            changed = true;
        } if (changed)
        await this.store.write('views', rows); }
}
