import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArguments, windowsPaneEnvironment } from "../runtime/actions.js";
import { serviceContext } from "../runtime/service.js";
import { acquireAdmission } from "../runtime/admission.js";
import { FollowSelection, inspectorVisible } from "../runtime/follow.js";
import { Collector } from "../runtime/collector.js";
import { demoData } from "../runtime/demo.js";
import { HerdrClient } from "../herdr/client.js";
import { SnapshotCache } from "../herdr/subscription.js";
import { StateStore } from "../state/store.js";
import { MailboxServer } from "../state/mailbox.js";
import { TerminalUi } from "../tui/terminal.js";
import { createUiState, renderScreen, handleKey, handleRowClick, showDetail, addMessagePage, addReferencePage, showReferenceSources } from "../tui/screen.js";
import { visibleReferences } from "../tui/reference-readers.js";
import { diagnosticExport } from "../tui/export.js";
import { copyText, openTarget } from "../tui/platform.js";
export async function main(argv = process.argv.slice(2)) {
    const args = parseArguments(['inspector', ...argv]);
    const state = createUiState();
    state.ascii = args.options.ascii === true;
    state.monochrome = args.options.monochrome === true;
    const ui = new TerminalUi({ monochrome: state.monochrome });
    let data;
    let frame;
    let cleanup = async () => { ui.close(); };
    let collector;
    let closing = false;
    let finished = false;
    let stopping;
    let syncVisibility = () => { };
    const paint = () => { syncVisibility(); frame = renderScreen(data, state, ui.columns, ui.rows); ui.paint(frame); };
    if (args.options.demo) {
        data = demoData();
        state.selectedKey = data.sessions[0]?.key;
        if (args.options.view && ['Overview', 'Agents', 'Processes', 'Messages', 'Refs', 'To-do'].includes(String(args.options.view)))
            state.tab = args.options.view;
        if (args.options.once || !process.stdin.isTTY) {
            paint();
            return;
        }
        ui.on('resize', paint);
        ui.start();
        paint();
    }
    else {
        const context = await serviceContext(args.options);
        state.ascii = state.ascii || context.settings.ascii;
        state.monochrome = state.monochrome || context.settings.monochrome;
        ui.setMonochrome(state.monochrome);
        const globalStore = new StateStore(context.stateDir);
        if ((await globalStore.read('lifecycle'))?.disabled)
            throw new Error('Plugin is deactivated');
        const rpc = new HerdrClient(context.endpoint);
        const admission = await acquireAdmission(context.stateDir);
        let lease;
        cleanup = async () => { ui.close(); rpc.close(); await lease?.release(); await admission.release(); };
        try {
            const store = new StateStore(context.serverStateDir);
            await store.init();
            const preferences = await store.read('preferences');
            const cache = new SnapshotCache(rpc);
            collector = new Collector({ rpc, endpoint: context.endpoint, settings: context.settings, stateDir: context.serverStateDir });
            lease = await store.acquire();
            cleanup = async () => { ui.close(); cache.close(); rpc.close(); await lease.release(); await admission.release(); };
            let paneId = process.env.HERDR_PANE_ID;
            let terminalId;
            let relocating = false;
            let widthFraction = 0.32;
            let ready = false;
            const followSelection = new FollowSelection();
            syncVisibility = () => {
                const visible = !closing && !cache.stale && inspectorVisible(cache.snapshot, terminalId, paneId);
                collector.setVisibleSession(state.selectedKey, visible);
                collector.setProcessesExpanded(visible && state.tab === 'Processes');
            };
            if (preferences) {
                if (Array.isArray(preferences.collapsed))
                    state.collapsed = new Set(preferences.collapsed.filter(x => typeof x === 'string').slice(0, 512));
                if (Array.isArray(preferences.expanded))
                    state.expanded = new Set(preferences.expanded.filter(x => typeof x === 'string').slice(0, 512));
                if (Array.isArray(preferences.readers))
                    for (const tuple of preferences.readers.slice(0, 64)) {
                        if (!Array.isArray(tuple) || tuple.length !== 2)
                            continue;
                        const [key, value] = tuple;
                        if (typeof key === 'string' && value && Number.isSafeInteger(value.cursor) && Number.isSafeInteger(value.scroll))
                            state.readers.set(key, value);
                    }
                state.selectedKey = preferences.selectedKey;
                state.pin = preferences.pin === true;
                if (preferences.tab && ['Overview', 'Agents', 'Processes', 'Messages', 'Refs', 'To-do'].includes(preferences.tab))
                    state.tab = preferences.tab;
            }
            const save = async () => { await store.write('preferences', { selectedKey: state.selectedKey, pin: state.pin, tab: state.tab, collapsed: [...state.collapsed].slice(0, 512), expanded: [...state.expanded].slice(0, 512), readers: [...state.readers].slice(-64) }); };
            const marker = async () => { await store.write('pane', { paneId, terminalId }); await store.write('controller', { token: lease.token, pid: process.pid, paneId, terminalId, endpoint: context.endpoint, startedAt: Date.now() }); };
            const mailbox = new MailboxServer(context.serverStateDir, lease.token, async (op, payload) => {
                if (op === 'ping')
                    return { alive: true, ready, stale: collector.data.stale, diagnostics: collector.data.diagnostics };
                if (op === 'location')
                    return { paneId, terminalId };
                if (op === 'refresh') {
                    await collector.refresh();
                    return { sessions: collector.data.sessions.length };
                }
                if (op === 'shutdown') {
                    setTimeout(() => void stop(), 100);
                    return { stopping: true };
                }
                if (op === 'set-goal') {
                    await collector.setGoal(payload.session, payload.objective, payload.status);
                    return { saved: true };
                }
                if (op === 'message-locator') {
                    const session = collector.data.sessions.find(s => s.key === payload.session);
                    if (!session)
                        throw new Error('Session unavailable');
                    return { provider: session.evidence.provider, ref: session.evidence.path ? { kind: 'path', value: session.evidence.path } : { kind: 'id', value: session.evidence.id }, messageId: payload.id, providerHomes: context.settings.providerHomes };
                }
                if (op === 'launch') {
                    await collector.sampleProcesses();
                    await collector.recordLaunch(payload);
                    return { registered: true };
                }
                if (op === 'exit-launch') {
                    collector.ledger.exit(payload.id);
                    await store.write('launches', collector.ledger.toJSON());
                    return { recorded: true };
                }
                throw new Error('Unknown collector operation');
            });
            cleanup = async () => {
                ui.close();
                cache.close();
                try {
                    await mailbox.close();
                    await collector.close();
                    await save();
                }
                finally {
                    rpc.close();
                    try {
                        const own = await store.read('controller');
                        if (own?.token === lease.token)
                            await store.remove('controller');
                    }
                    finally {
                        await lease.release();
                        await admission.release();
                    }
                }
            };
            try {
                await cache.start();
                const current = paneId ? await rpc.call('pane.current', { caller_pane_id: paneId }) : undefined;
                paneId = current?.pane?.pane_id ?? current?.pane_id ?? paneId;
                terminalId = current?.pane?.terminal_id ?? current?.terminal_id;
                if (paneId) {
                    try {
                        const layoutResult = await rpc.call('pane.layout', { pane_id: paneId });
                        const layout = layoutResult.layout ?? layoutResult;
                        const rect = layout.panes?.find((p) => p.pane_id === paneId)?.rect;
                        if (rect?.width && layout.area?.width)
                            widthFraction = Math.min(.6, Math.max(.2, rect.width / layout.area.width));
                    }
                    catch { /* Default right-side width is used until layout exposes an area. */ }
                }
                await store.write('server', { endpoint: context.endpoint });
                await store.write('pane', { paneId, terminalId });
                await marker();
                await mailbox.start();
                syncVisibility();
                await collector.start();
                data = collector.data;
                if (!state.selectedKey || !data.sessions.some(session => session.key === state.selectedKey)) {
                    state.selectedKey = data.sessions.find(session => session.key === collector.displayedSessionKey)?.key ?? data.sessions.find(session => session.attachment?.focused)?.key ?? data.sessions[0]?.key;
                    syncVisibility();
                    await collector.refresh();
                    data = collector.data;
                }
                ready = !data.stale;
                await admission.release();
                if (closing) {
                    await stop();
                    return;
                }
                if (args.options.once || !process.stdin.isTTY) {
                    paint();
                    await cleanup();
                    return;
                }
                ui.start();
                const follow = async () => {
                    const snapshot = cache.snapshot;
                    if (!snapshot || state.pin || !context.settings.follow || relocating)
                        return;
                    const focused = snapshot.agents.find(agent => agent.pane_id === snapshot.focused_pane_id);
                    if (!focused)
                        return;
                    const selectedKey = followSelection.observe(snapshot, data, state.pin);
                    if (selectedKey) {
                        state.selectedKey = selectedKey;
                        paint();
                    }
                    const own = snapshot.panes.find(p => p.terminal_id === terminalId);
                    if (own && typeof own.pane_id === 'string')
                        paneId = own.pane_id;
                    if (!paneId || own?.tab_id === focused.tab_id)
                        return;
                    relocating = true;
                    try {
                        const result = await rpc.call('pane.move', { pane_id: paneId, destination: { type: 'tab', tab_id: focused.tab_id, target_pane_id: focused.pane_id, split: 'right', ratio: 1 - widthFraction }, focus: false });
                        paneId = result.move_result?.pane?.pane_id ?? result.pane?.pane_id ?? paneId;
                        await marker();
                    }
                    catch (error) {
                        state.notice = error.message;
                    }
                    finally {
                        relocating = false;
                    }
                };
                cache.on('snapshot', () => { syncVisibility(); collector.invalidate(); void follow(); });
                cache.on('stale', () => { collector.setVisibleSession(state.selectedKey, false); data.stale = true; paint(); });
                collector.on('data', (next) => {
                    data = next;
                    ready = !data.stale;
                    if (!state.selectedKey || !data.sessions.some(s => s.key === state.selectedKey))
                        state.selectedKey = data.sessions.find(s => s.key === collector.displayedSessionKey)?.key ?? data.sessions.find(s => s.attachment?.focused)?.key ?? data.sessions[0]?.key;
                    paint();
                    void follow();
                });
                collector.on('diagnostic', (message) => { state.notice = message; paint(); });
                ui.on('resize', () => {
                    paint();
                    if (paneId)
                        void rpc.call('pane.layout', { pane_id: paneId }).then(result => {
                            const layout = result.layout ?? result;
                            const rect = layout.panes?.find((p) => p.pane_id === paneId)?.rect;
                            if (rect?.width && layout.area?.width)
                                widthFraction = Math.min(.6, Math.max(.2, rect.width / layout.area.width));
                        }).catch(() => { });
                });
                let referenceRequest = false;
                const perform = async (action) => {
                    if (action.type === 'quit')
                        return stop();
                    if (action.type === 'pin') {
                        await save();
                        if (!state.pin) {
                            followSelection.reset();
                            await follow();
                        }
                        return;
                    }
                    if (action.type === 'scope') {
                        collector.setScope(state.subtree);
                        return;
                    }
                    if (action.type === 'toggle-todo') {
                        await collector.toggleTodo(action.sessionKey, action.id);
                        return;
                    }
                    if (action.type === 'copy') {
                        await copyText(action.text ?? '');
                        state.notice = 'Copy requested';
                        return;
                    }
                    if (action.type === 'open-ref') {
                        await openTarget(action.target);
                        return;
                    }
                    if (action.type === 'export') {
                        const report = diagnosticExport(data);
                        const filename = path.join(context.serverStateDir, `export-${Date.now()}.txt`);
                        const { atomicWrite } = await import("../config/safe-file.js");
                        await atomicWrite(filename, report);
                        state.notice = `Exported ${filename}`;
                        return;
                    }
                    if (action.type === 'settings') {
                        showDetail(state, JSON.stringify(context.settings, null, 2) + '\nUse the settings action --set KEY=JSON_VALUE to change persisted settings.');
                        return;
                    }
                    if (action.type === 'page-messages') {
                        const page = await collector.pageMessages(action.sessionKey, action.beforeId);
                        addMessagePage(state, action.sessionKey, page);
                        state.notice = page.length ? `Loaded ${page.length} older messages` : 'No older messages available';
                        return;
                    }
                    if (action.type === 'page-refs' || action.type === 'ref-sources') {
                        const key = action.sessionKey, session = data.sessions.find(session => session.key === key);
                        if (!session || referenceRequest)
                            return;
                        referenceRequest = true;
                        try {
                            const revision = session.evidence.contentRevision;
                            if (action.type === 'page-refs') {
                                const excluded = [...(session.refs ?? []), ...(!action.restart ? state.pagedRefs.get(key)?.refs ?? [] : [])].map(ref => ref.id);
                                const page = await collector.pageReferences(key, { cursor: action.referencePageCursor, excludeIds: excluded, limit: 50 });
                                if (page && !closing && state.selectedKey === key && state.tab === 'Refs' && !state.refSources) {
                                    if (action.restart)
                                        state.pagedRefs.delete(key);
                                    addReferencePage(state, key, page, revision);
                                    state.notice = page.refs.length ? undefined : 'No older reference targets';
                                }
                            }
                            else {
                                const reader = state.refSources, reference = reader && reader.reference.id === action.id ? reader.reference : visibleReferences(session, state).find(ref => ref.id === action.id);
                                if (!reference)
                                    return;
                                const page = await collector.pageReferenceSources(key, reference.id, { cursor: action.referencePageCursor, limit: 50 });
                                if (page && !closing && state.selectedKey === key && state.tab === 'Refs')
                                    showReferenceSources(state, key, reference, page, revision, Boolean(action.referencePageCursor) && !action.restart);
                            }
                        }
                        finally {
                            referenceRequest = false;
                        }
                        return;
                    }
                    if (action.type === 'focus') {
                        const selected = data.sessions.find(s => s.key === action.sessionKey);
                        if (!selected)
                            return;
                        state.selectedKey = selected.key;
                        if (selected.attachment) {
                            await collector.focus(selected.key);
                        }
                        else {
                            state.tab = 'Messages';
                            state.cursor = 0;
                            state.cursorId = undefined;
                        }
                        return;
                    }
                    if (action.type === 'source') {
                        const message = action.referenceCursor ? await collector.referenceMessage(action.referenceCursor) : await collector.message(action.sessionKey, action.id);
                        if (closing || state.selectedKey !== action.sessionKey)
                            return;
                        showDetail(state, message ? `${message.role}\n${message.text}` : 'Source message unavailable');
                        return;
                    }
                    if (action.type === 'message') {
                        const message = action.id && action.sessionKey ? await collector.message(action.sessionKey, action.id) : undefined;
                        const text = message ? `${message.role}\n${message.text}\n${(message.tools ?? []).map(t => `${t.status} ${t.name}: ${t.summary ?? ''}`).join('\n')}` : action.text ?? 'No detail';
                        if (message && action.sessionKey) {
                            try {
                                await rpc.call('plugin.pane.open', { plugin_id: 'iob.herdr-prism', entrypoint: 'detail', placement: 'popup', env: { ...(process.platform === 'win32' ? windowsPaneEnvironment() : {}), HAT_DETAIL_SESSION: action.sessionKey, HAT_DETAIL_MESSAGE: action.id }, focus: true });
                                return;
                            }
                            catch { /* ui_busy or unsupported popup uses the in-panel detail. */ }
                        }
                        showDetail(state, text);
                        return;
                    }
                };
                ui.on('input', async (event) => {
                    try {
                        if (event.type === 'mouse') {
                            if (event.release)
                                return;
                            if (event.y === 3 && event.button === 0 && ui.columns >= 65) {
                                const { tabs } = await import("../tui/types.js");
                                let start = 1;
                                for (const tab of tabs) {
                                    const width = tab.length + (tab === state.tab ? 2 : 0);
                                    if (event.x >= start && event.x < start + width) {
                                        state.tab = tab;
                                        state.cursor = 0;
                                        state.cursorId = undefined;
                                        state.scroll = 0;
                                        break;
                                    }
                                    start += width + 1;
                                }
                            }
                            else if (event.button === 64 || event.button === 65) {
                                state.cursor += event.button === 64 ? -3 : 3;
                                state.cursorId = undefined;
                            }
                            else if (event.button === 0) {
                                const action = handleRowClick(state, event.x, event.y, data, frame);
                                if (action)
                                    await perform(action);
                            }
                        }
                        else {
                            const action = handleKey(state, event.key, data, frame);
                            if (action)
                                await perform(action);
                        }
                        if (!closing)
                            paint();
                    }
                    catch (error) {
                        state.notice = error.message;
                        if (!closing)
                            paint();
                    }
                });
                paint();
                await follow();
            }
            catch (error) {
                await cleanup();
                throw error;
            }
        }
        catch (error) {
            await cleanup();
            throw error;
        }
    }
    async function stop() {
        if (stopping)
            return stopping;
        closing = true;
        collector?.setVisibleSession(state.selectedKey, false);
        stopping = cleanup().finally(() => { finished = true; });
        return stopping;
    }
    if (args.options.demo)
        ui.on('input', async (event) => {
            if (event.type !== 'key')
                return;
            const action = handleKey(state, event.key, data, frame);
            if (action?.type === 'quit')
                await stop();
            else if (action?.type === 'focus')
                state.selectedKey = action.sessionKey;
            else if (action?.type === 'message')
                showDetail(state, action.text ?? '');
            else if (action?.type === 'ref-sources') {
                const session = data.sessions.find(session => session.key === action.sessionKey), reference = session?.refs?.find(ref => ref.id === action.id);
                if (reference)
                    showReferenceSources(state, session.key, reference, { sources: reference.sources ?? [{ messageId: reference.messageId, source: reference.source }], hasMore: false, partial: true, observedAt: Date.now() }, session.evidence.contentRevision);
            }
            else if (action?.type === 'page-refs')
                state.notice = 'Demo has no additional reference history';
            else if (action?.type === 'source') {
                const session = data.sessions.find(session => session.key === action.sessionKey), message = session?.evidence.messages.find(message => message.id === action.id);
                showDetail(state, message ? `Demo source\n${message.text}` : 'Demo source unavailable');
            }
            else if (action?.type === 'scope')
                state.notice = 'Demo fixture scopes';
            else if (action?.type === 'toggle-todo') {
                const session = data.sessions.find(s => s.key === action.sessionKey);
                const todo = session?.todos?.find(t => t.id === action.id);
                if (todo)
                    todo.checked = !todo.checked;
            }
            if (!closing)
                paint();
        });
    process.once('SIGINT', () => void stop());
    process.once('SIGTERM', () => void stop());
    process.stdin.once('end', () => void stop());
    await new Promise(resolve => {
        const check = setInterval(() => {
            if (finished) {
                clearInterval(check);
                resolve();
            }
        }, 100);
    });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
