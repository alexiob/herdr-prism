import { NotesController } from "../tui/notes.js";
import { NotesStore } from "../state/notes.js";
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArguments } from "../runtime/actions.js";
import { serviceContext } from "../runtime/service.js";
import { acquireAdmission } from "../runtime/admission.js";
import { FollowSelection, resolveInspectorBinding, reconcileInspectorSelection, clearInspectionOverlays, resumeBoundSelection, boundNoteAdoption, resolveNotesSessionKey, inspectorVisible } from "../runtime/follow.js";
import { RemoteCollector } from "../runtime/remote-collector.js";
import { ViewFailureReporter } from "../runtime/view-failure.js";
import { panelViewStore, waitForPanelRecord } from "../runtime/panel-views.js";
import { demoData } from "../runtime/demo.js";
import { HerdrClient } from "../herdr/client.js";
import { StateStore } from "../state/store.js";
import { TerminalUi } from "../tui/terminal.js";
import { createUiState, renderScreen, handleKey, handleRowClick, handleRowWheel, showDetail, addMessagePage, addReferencePage, showReferenceSources } from "../tui/screen.js";
import { withProcessOutput } from "../process/output.js";
import { messageDocument } from "../tui/facts.js";
import { documentText } from "../tui/widgets.js";
import { visibleReferences } from "../tui/reference-readers.js";
import { diagnosticExport } from "../tui/export.js";
import { copyText, openTarget } from "../tui/platform.js";
import { tabs } from "../tui/types.js";
export async function main(argv = process.argv.slice(2)) {
    const args = parseArguments(['inspector', ...argv]);
    const state = createUiState();
    state.ascii = args.options.ascii === true;
    state.monochrome = args.options.monochrome === true;
    if (args.options.theme) {
        if (!['dark', 'light', 'mono'].includes(String(args.options.theme)))
            throw new Error('Theme must be dark, light or mono');
        state.theme = args.options.theme;
    }
    const ui = new TerminalUi({ monochrome: state.monochrome });
    let data;
    let frame;
    let cleanup = async () => { ui.close(); };
    let collector;
    let closing = false;
    let finished = false;
    let stopping;
    let syncVisibility = () => { };
    let syncBoundSelection = () => { };
    let panelVisible = () => true;
    let notes;
    let notesStore;
    let ownNotesTerminalId;
    let inputQueue = Promise.resolve();
    let startupPhase = 'context';
    let failureReporter;
    const recordFailure = async (error, phase = startupPhase) => { await failureReporter?.record(phase === 'remote-start' ? 'remote:' + collector?.startupPhase : phase, error).catch(() => { }); };
    const ensureNotes = async (reload = false) => { const key = resolveNotesSessionKey(state); if (state.tab !== 'Notes' || !key || notes?.value?.editing || !panelVisible())
        return; const session = data.sessions.find(s => s.key === key); if (!session || !notes)
        return; const changed = notes.value?.sessionKey !== session.key; if (changed && notesStore && ownNotesTerminalId) {
        const identity = boundNoteAdoption(session, key, state.boundSessionKey, ownNotesTerminalId);
        if (identity)
            await notesStore.adoptOwnPlaceholder(identity);
    } await notes.open(session.key, session.evidence.title ?? session.evidence.id, reload); if (changed)
        state.notesScroll = 0; state.notes = notes.value; };
    const connectNotes = (dir) => { notesStore = new NotesStore(dir); notes = new NotesController(notesStore); notes.on('change', () => { state.notes = notes.value; if (!closing)
        paint(); }); };
    const editorInput = async (event) => {
        if (!notes?.value?.editing)
            return false;
        if (event.type === 'paste') {
            state.notesFreeScroll = false;
            if (event.overflow)
                state.notice = 'Paste exceeds 1 MiB; nothing inserted';
            else
                notes.paste(event.text, { columns: ui.columns, height: ui.rows, tabOrder: state.tabOrder });
            return true;
        }
        if (event.type === 'mouse') {
            if (event.release)
                return true;
            if (event.button === 64 || event.button === 65) {
                handleRowWheel(state, event.x, event.y, event.button === 64 ? -3 : 3, frame);
                state.notesFreeScroll = true;
                return true;
            }
            const tab = frame.tabRegions?.find(r => r.y === event.y && event.x >= r.x && event.x < r.x + r.width);
            if (!tab)
                return true;
            await notes.end();
            return false;
        }
        if (event.key === 'ctrl+s') {
            await notes.flush();
            return true;
        }
        if (event.key === 'escape') {
            await notes.end();
            return true;
        }
        if (['tab', 'shift+tab', 'ctrl+c'].includes(event.key)) {
            await notes.end();
            return false;
        }
        state.notesFreeScroll = false;
        return notes.key(event.key, { columns: ui.columns, height: ui.rows, tabOrder: state.tabOrder });
    };
    const paint = () => { syncBoundSelection(); syncVisibility(); ui.requestPaint(() => { frame = renderScreen(data, state, ui.columns, ui.rows); return frame; }); };
    if (args.options.demo) {
        data = demoData();
        state.selectedKey = data.sessions[0]?.key;
        if (args.options.view && tabs.includes(String(args.options.view)))
            state.tab = args.options.view;
        if (args.options.once || !process.stdin.isTTY) {
            paint();
            return;
        }
        const demoDir = await mkdtemp(path.join(tmpdir(), 'prism-demo-notes-'));
        connectNotes(demoDir);
        cleanup = async () => { await notes.close(); ui.close(); await rm(demoDir, { recursive: true, force: true }); };
        await ensureNotes();
        ui.on('resize', paint);
        ui.start();
        paint();
    }
    else {
        state.restrictAutomaticSelection = true;
        const context = await serviceContext(args.options);
        state.theme ??= context.settings.theme;
        state.ascii = state.ascii || context.settings.ascii;
        state.monochrome = state.monochrome || context.settings.monochrome;
        ui.setMonochrome(state.monochrome);
        const globalStore = new StateStore(context.stateDir);
        if ((await globalStore.read('lifecycle'))?.disabled)
            throw new Error('Plugin is deactivated');
        failureReporter = new ViewFailureReporter(context.serverStateDir, process.env.HERDR_PANE_ID ?? 'pid:' + process.pid);
        const rpc = new HerdrClient(context.endpoint);
        startupPhase = 'admission';
        const admission = await acquireAdmission(context.stateDir).catch(async (error) => { await recordFailure(error); rpc.close(); throw error; });
        let lease;
        cleanup = async () => { ui.close(); rpc.close(); await lease?.release(); await admission.release(); };
        try {
            startupPhase = 'server-state';
            const serverStore = new StateStore(context.serverStateDir);
            await serverStore.init();
            await serverStore.read('preferences');
            startupPhase = 'snapshot-start';
            const initial = await rpc.call('session.snapshot');
            const cache = { snapshot: initial.snapshot ?? initial, stale: false };
            if (!Array.isArray(cache.snapshot?.panes) || !Array.isArray(cache.snapshot?.agents))
                throw new Error('Invalid initial native snapshot');
            cleanup = async () => { ui.close(); rpc.close(); await lease?.release(); await admission.release(); };
            startupPhase = 'pane-identity';
            let paneId = process.env.HERDR_PANE_ID;
            const current = paneId ? await rpc.call('pane.current', { caller_pane_id: paneId }) : undefined;
            paneId = current?.pane?.pane_id ?? current?.pane_id ?? paneId;
            const terminalId = current?.pane?.terminal_id ?? current?.terminal_id;
            const ownPane = cache.snapshot?.panes.find(p => p.terminal_id === terminalId);
            if (!paneId || !terminalId || typeof ownPane?.tab_id !== 'string')
                throw new Error('Inspector requires its registered Herdr pane identity');
            const tabId = ownPane.tab_id;
            startupPhase = 'bound-record';
            const record = await waitForPanelRecord(serverStore, { paneId, terminalId, tabId });
            const targetTerminalId = record.targetTerminalId;
            ownNotesTerminalId = targetTerminalId;
            const store = panelViewStore(context.serverStateDir, tabId, targetTerminalId);
            startupPhase = 'view-lease';
            await store.init();
            lease = await store.acquire();
            const preferences = await store.read('preferences');
            collector = new RemoteCollector(context, paneId, terminalId);
            const followSelection = new FollowSelection();
            panelVisible = () => !closing && !cache.stale && inspectorVisible(cache.snapshot, terminalId, paneId);
            syncVisibility = () => {
                syncBoundSelection();
                const visible = panelVisible();
                ui.setVisible(!closing && inspectorVisible(cache.snapshot, terminalId, paneId));
                collector.setVisibleSession(state.tab === 'Notes' ? resolveNotesSessionKey(state) : state.selectedKey, visible);
                collector.setProcessesExpanded(visible && state.tab === 'Processes');
            };
            if (preferences) {
                if (Array.isArray(preferences.collapsed))
                    state.collapsed = new Set(preferences.collapsed.filter((x) => typeof x === 'string').slice(0, 512));
                if (Array.isArray(preferences.expanded))
                    state.expanded = new Set(preferences.expanded.filter((x) => typeof x === 'string').slice(0, 512));
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
                if (tabs.includes(preferences.tab))
                    state.tab = preferences.tab;
            }
            const save = async () => { await store.write('preferences', { selectedKey: state.selectedKey, pin: state.pin, tab: state.tab, collapsed: [...state.collapsed].slice(0, 512), expanded: [...state.expanded].slice(0, 512), readers: [...state.readers].slice(-64) }); };
            cleanup = async () => { await notes?.close(); ui.close(); try {
                await collector.close();
                await save();
            }
            finally {
                rpc.close();
                await lease.release();
                await admission.release();
            } };
            // The service owns its own admission check; do not hold a UI's gate
            // while waiting for its detached owner to start.
            await admission.release();
            syncBoundSelection = () => { const binding = resolveInspectorBinding(data, tabId, targetTerminalId, state.boundSessionKey, { restoredSelection: typeof preferences?.selectedKey === 'string' ? preferences.selectedKey : undefined }); state.boundSessionKey = binding.key; state.boundSessionPending = binding.pending; };
            try {
                startupPhase = 'remote-start';
                await collector.start();
                data = collector.data;
                cache.snapshot = collector.snapshot;
                cache.stale = data.stale;
                syncBoundSelection();
                reconcileInspectorSelection(data, state, state.boundSessionKey, true);
                startupPhase = 'selected-poll';
                syncVisibility();
                await collector.refresh();
                data = collector.data;
                cache.snapshot = collector.snapshot;
                cache.stale = data.stale;
                if (closing) {
                    await stop();
                    return;
                }
                if (args.options.once || !process.stdin.isTTY) {
                    if (!args.options.once)
                        await recordFailure(new Error('Inspector standard input is not a TTY'), 'interactive-tty');
                    paint();
                    await cleanup();
                    return;
                }
                startupPhase = 'notes-open';
                connectNotes(context.serverStateDir);
                await ensureNotes();
                startupPhase = 'ui-start';
                ui.start();
                const follow = async () => {
                    const snapshot = cache.snapshot;
                    if (!snapshot || state.pin || state.boundSessionPending || state.processConfirmation || state.notes?.editing || !context.settings.follow)
                        return;
                    const selectedKey = followSelection.observeLocal(snapshot, data, tabId, state.pin, targetTerminalId);
                    if (selectedKey) {
                        await notes?.end();
                        if (selectedKey !== state.selectedKey)
                            clearInspectionOverlays(state);
                        state.selectedKey = selectedKey;
                        await ensureNotes();
                        paint();
                    }
                };
                const queueFollow = () => { inputQueue = inputQueue.then(async () => { if (!closing) {
                    await ensureNotes();
                    await follow();
                } }).catch(error => { state.notice = error.message; if (!closing)
                    paint(); }); };
                collector.on('snapshot', (snapshot) => { const wasVisible = inspectorVisible(cache.snapshot, terminalId, paneId); cache.snapshot = snapshot; cache.stale = collector.data.stale; syncVisibility(); queueFollow(); if (!wasVisible && inspectorVisible(snapshot, terminalId, paneId))
                    paint(); });
                collector.on('stale', () => { cache.stale = true; collector.setVisibleSession(state.selectedKey, false); data.stale = true; paint(); });
                collector.on('data', (next) => { data = next; cache.stale = next.stale; syncBoundSelection(); if (!state.processConfirmation && !state.notes?.editing)
                    reconcileInspectorSelection(data, state, state.boundSessionKey); paint(); queueFollow(); });
                collector.on('diagnostic', (message) => { state.notice = message; paint(); });
                collector.once('disconnected', (error) => { inputQueue = inputQueue.then(async () => { await recordFailure(error, 'poll-disconnect'); await stop(); }); });
                ui.on('resize', paint);
                let referenceRequest = false;
                let contentRequest = 0;
                let outputRequest = 0;
                const refreshProcessOutput = async (sessionKey, target, document = state.detailDocument) => {
                    if (!document || state.help || !panelVisible() || state.selectedKey !== sessionKey)
                        return;
                    const request = ++outputRequest;
                    try {
                        const output = await collector.processOutput(sessionKey, target);
                        if (closing || request !== outputRequest || state.help || !panelVisible() || state.selectedKey !== sessionKey || state.detailDocument !== document)
                            return;
                        state.detailDocument = withProcessOutput(document, output);
                        state.detail = documentText(state.detailDocument);
                        paint();
                    }
                    catch (error) {
                        if (!closing && request === outputRequest && !state.help && panelVisible() && state.selectedKey === sessionKey && state.detailDocument === document) {
                            state.detailDocument = withProcessOutput(document, { availability: 'unavailable', scope: 'shared-terminal', pid: target.pid, owner: target.owner, processKey: target.key, capturedAt: Date.now(), reason: error.message });
                            state.detail = documentText(state.detailDocument);
                            paint();
                        }
                    }
                };
                const perform = async (action) => {
                    if (action.type === 'quit') {
                        contentRequest++;
                        return stop();
                    }
                    if (action.type === 'follow-bound') {
                        if (state.processConfirmation)
                            return;
                        await notes?.end();
                        syncBoundSelection();
                        if (!resumeBoundSelection(state)) {
                            state.notice = 'Bound native agent is unavailable';
                            return;
                        }
                        contentRequest++;
                        outputRequest++;
                        followSelection.reset();
                        state.notice = undefined;
                        syncVisibility();
                        await save();
                        collector.invalidate();
                        return;
                    }
                    if (action.type === 'pin') {
                        if (!state.pin) {
                            followSelection.reset();
                            await follow();
                        }
                        await save();
                        return;
                    }
                    if (action.type === 'process-output') {
                        if (action.sessionKey && action.processTarget)
                            void refreshProcessOutput(action.sessionKey, action.processTarget);
                        return;
                    }
                    if (action.type === 'terminate-process') {
                        const result = await collector.terminateProcess(action.sessionKey, action.processTarget);
                        state.notice = `${result.platform === 'win32' ? 'Termination' : 'SIGTERM'} requested for PID ${result.pid}`;
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
                                    addReferencePage(state, key, page, page.contentRevision ?? revision);
                                    state.notice = page.refs.length ? undefined : 'No older reference targets';
                                }
                            }
                            else {
                                const reader = state.refSources, reference = reader && reader.reference.id === action.id ? reader.reference : visibleReferences(session, state).find(ref => ref.id === action.id);
                                if (!reference)
                                    return;
                                const page = await collector.pageReferenceSources(key, reference.id, { cursor: action.referencePageCursor, limit: 50 });
                                if (page && !closing && state.selectedKey === key && state.tab === 'Refs')
                                    showReferenceSources(state, key, reference, page, page.contentRevision ?? revision, Boolean(action.referencePageCursor) && !action.restart);
                            }
                        }
                        finally {
                            referenceRequest = false;
                        }
                        return;
                    }
                    if (action.type === 'tab') {
                        contentRequest++;
                        await notes?.end();
                        await ensureNotes();
                        return;
                    }
                    if (action.type === 'notes-edit') {
                        await ensureNotes(true);
                        if (notes && notes.value?.sessionKey === resolveNotesSessionKey(state))
                            notes.begin({ columns: ui.columns, height: ui.rows, tabOrder: state.tabOrder });
                        state.notice = undefined;
                        return;
                    }
                    if (action.type === 'select') {
                        await notes?.end();
                        contentRequest++;
                        const selected = data.sessions.find(session => session.key === action.sessionKey);
                        if (selected) {
                            clearInspectionOverlays(state);
                            state.selectedKey = selected.key;
                            state.tab = 'Overview';
                            state.cursor = 0;
                            state.cursorId = undefined;
                            state.scroll = 0;
                            syncVisibility();
                            collector.invalidate();
                        }
                        return;
                    }
                    if (action.type === 'focus') {
                        await notes?.end();
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
                        const request = ++contentRequest, tab = state.tab;
                        const message = action.referenceCursor ? await collector.referenceMessage(action.referenceCursor) : await collector.message(action.sessionKey, action.id);
                        if (closing || state.selectedKey !== action.sessionKey || state.tab !== tab || request !== contentRequest)
                            return;
                        showDetail(state, message ? `${message.role}\n${message.text}` : 'Source message unavailable', message ? messageDocument(message) : undefined);
                        return;
                    }
                    if (action.type === 'message') {
                        const request = ++contentRequest, tab = state.tab, key = state.selectedKey;
                        const message = action.id && action.sessionKey ? await collector.message(action.sessionKey, action.id) : undefined;
                        if (closing || key !== state.selectedKey || tab !== state.tab || request !== contentRequest)
                            return;
                        const text = message ? `${message.role}\n${message.text}\n${(message.tools ?? []).map(t => `${t.status} ${t.name}: ${t.summary ?? ''}`).join('\n')}` : action.text ?? 'No detail';
                        const document = action.document ?? (message ? messageDocument(message) : undefined);
                        showDetail(state, text, document);
                        if (document?.processTarget && key)
                            void refreshProcessOutput(key, document.processTarget, document);
                        return;
                    }
                };
                const processInput = async (event) => {
                    try {
                        if (await editorInput(event)) {
                            if (!state.notes?.editing)
                                await ensureNotes();
                            paint();
                            if (!state.notes?.editing)
                                await follow();
                            return;
                        }
                        if (event.type === 'mouse') {
                            if (event.release)
                                return;
                            if (event.button === 64 || event.button === 65) {
                                if (!handleRowWheel(state, event.x, event.y, event.button === 64 ? -3 : 3, frame)) {
                                    state.cursor += event.button === 64 ? -3 : 3;
                                    state.cursorId = undefined;
                                }
                            }
                            else if (event.button === 0) {
                                const action = handleRowClick(state, event.x, event.y, data, frame);
                                if (action)
                                    await perform(action);
                            }
                        }
                        else if (event.type === 'key') {
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
                };
                ui.on('input', (event) => { if (!closing)
                    inputQueue = inputQueue.then(() => processInput(event)); });
                startupPhase = 'initial-paint';
                paint();
                startupPhase = 'initial-follow';
                await follow();
                startupPhase = 'ready-receipt';
                await collector.markReady();
                startupPhase = 'running';
            }
            catch (error) {
                await recordFailure(error);
                await cleanup();
                throw error;
            }
        }
        catch (error) {
            await recordFailure(error);
            await cleanup();
            throw error;
        }
    }
    async function stop() {
        if (stopping)
            return stopping;
        closing = true;
        collector?.setVisibleSession(state.selectedKey, false);
        stopping = cleanup().then(() => { finished = true; }).catch(error => { closing = false; stopping = undefined; state.notice = 'Cannot close until notes are saved: ' + error.message; paint(); });
        return stopping;
    }
    if (args.options.demo) {
        const demoInput = async (event) => {
            try {
                if (await editorInput(event)) {
                    paint();
                    return;
                }
                if (event.type === 'mouse' && !event.release && (event.button === 64 || event.button === 65)) {
                    if (!handleRowWheel(state, event.x, event.y, event.button === 64 ? -3 : 3, frame)) {
                        state.cursor += event.button === 64 ? -3 : 3;
                        state.cursorId = undefined;
                    }
                    paint();
                    return;
                }
                if (event.type !== 'key')
                    return;
                const action = handleKey(state, event.key, data, frame);
                if (action?.type === 'quit')
                    await stop();
                else if (action?.type === 'focus' || action?.type === 'select') {
                    state.selectedKey = action.sessionKey;
                    if (action.type === 'select')
                        state.tab = 'Overview';
                }
                else if (action?.type === 'terminate-process')
                    state.notice = `Demo: simulated termination of PID ${action.processTarget.pid}; no OS signal sent`;
                else if (action?.type === 'tab')
                    await ensureNotes();
                else if (action?.type === 'notes-edit') {
                    await ensureNotes(true);
                    if (notes && notes.value?.sessionKey === resolveNotesSessionKey(state))
                        notes.begin({ columns: ui.columns, height: ui.rows, tabOrder: state.tabOrder });
                }
                else if (action?.type === 'message') {
                    const target = action.document?.processTarget;
                    const document = target ? withProcessOutput(action.document, { availability: 'known', scope: 'shared-terminal', pid: target.pid, owner: target.owner, processKey: target.key, capturedAt: Date.now(), text: '[DEMO] Shared harness terminal\n$ build\nCompiling project…\nBuild completed.\nThis fixture does not capture a real process.' }) : action.document;
                    showDetail(state, document ? documentText(document) : action.text ?? '', document);
                }
                else if (action?.type === 'process-output')
                    state.notice = 'Demo: retained output is a fixture; no terminal capture requested';
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
            }
            catch (error) {
                state.notice = error.message;
                paint();
            }
        };
        ui.on('input', (event) => { if (!closing)
            inputQueue = inputQueue.then(() => demoInput(event)); });
    }
    process.once('SIGINT', () => { inputQueue = inputQueue.then(() => stop()); });
    process.once('SIGTERM', () => { inputQueue = inputQueue.then(() => stop()); });
    process.stdin.once('end', () => { inputQueue = inputQueue.then(() => stop()); });
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
