import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArguments, openPanel, windowsPaneEnvironment } from '../runtime/actions.ts';
import { serviceContext } from '../runtime/service.ts';
import { acquireAdmission } from '../runtime/admission.ts';
import { FollowSelection, inspectorVisible } from '../runtime/follow.ts';
import { RemoteCollector } from '../runtime/remote-collector.ts';
import {panelViewStore} from '../runtime/panel-views.ts';
import { demoData } from '../runtime/demo.ts';
import { HerdrClient } from '../herdr/client.ts';
import { SnapshotCache } from '../herdr/subscription.ts';
import { StateStore } from '../state/store.ts';
import { TerminalUi } from '../tui/terminal.ts';
import { createUiState, renderScreen, handleKey, handleRowClick, showDetail, addMessagePage, addReferencePage, showReferenceSources } from '../tui/screen.ts';
import {visibleReferences} from '../tui/reference-readers.ts';
import { diagnosticExport } from '../tui/export.ts';
import { copyText, openTarget } from '../tui/platform.ts';
import type { DashboardData, RenderedScreen, UiAction } from '../tui/types.ts';
export async function main(argv = process.argv.slice(2)) {
    const args = parseArguments(['inspector', ...argv]);
    const state = createUiState();
    state.ascii = args.options.ascii === true;
    state.monochrome = args.options.monochrome === true;
    const ui = new TerminalUi({ monochrome: state.monochrome });
    let data: DashboardData;
    let frame: RenderedScreen;
    let cleanup: () => Promise<void> = async () => { ui.close(); };
    let collector: RemoteCollector | undefined;
    let closing = false;
    let finished = false;
    let stopping: Promise<void> | undefined;
    let syncVisibility = () => {};
    const paint = () => { syncVisibility(); frame = renderScreen(data, state, ui.columns, ui.rows); ui.paint(frame); };
    if (args.options.demo) {
        data = demoData();
        state.selectedKey = data.sessions[0]?.key;
        if (args.options.view && ['Overview', 'Agents', 'Processes', 'Messages', 'Refs', 'To-do'].includes(String(args.options.view)))
            state.tab = args.options.view as any;
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
        if ((await globalStore.read<{
            disabled: boolean;
        }>('lifecycle'))?.disabled)
            throw new Error('Plugin is deactivated');
        const rpc = new HerdrClient(context.endpoint);
        const admission = await acquireAdmission(context.stateDir);
        let lease: Awaited<ReturnType<StateStore['acquire']>> | undefined;
        cleanup = async () => { ui.close(); rpc.close(); await lease?.release(); await admission.release(); };
        try {
            const serverStore = new StateStore(context.serverStateDir);
            await serverStore.init();
            await serverStore.read<any>('preferences');
            const cache = new SnapshotCache(rpc);
            cleanup = async () => { ui.close(); cache.close(); rpc.close(); await lease?.release(); await admission.release(); };
            await cache.start();
            let paneId = process.env.HERDR_PANE_ID;
            const current = paneId ? await rpc.call('pane.current', {caller_pane_id:paneId}) : undefined;
            paneId = current?.pane?.pane_id ?? current?.pane_id ?? paneId;
            const terminalId = current?.pane?.terminal_id ?? current?.terminal_id;
            const ownPane = cache.snapshot?.panes.find(p=>p.terminal_id===terminalId);
            if (!paneId || !terminalId || typeof ownPane?.tab_id!=='string') throw new Error('Inspector requires its registered Herdr pane identity');
            const tabId = ownPane.tab_id;
            const store = panelViewStore(context.serverStateDir,tabId);
            await store.init();lease=await store.acquire();
            const preferences=await store.read<any>('preferences');
            collector = new RemoteCollector(context,paneId,terminalId);
            const followSelection = new FollowSelection();
            syncVisibility = () => {
                const visible=!closing&&!cache.stale&&inspectorVisible(cache.snapshot,terminalId,paneId);
                collector!.setVisibleSession(state.selectedKey,visible);
                collector!.setProcessesExpanded(visible&&state.tab==='Processes');
            };
            if(preferences){
                if(Array.isArray(preferences.collapsed))state.collapsed=new Set(preferences.collapsed.filter((x:any)=>typeof x==='string').slice(0,512));
                if(Array.isArray(preferences.expanded))state.expanded=new Set(preferences.expanded.filter((x:any)=>typeof x==='string').slice(0,512));
                if(Array.isArray(preferences.readers))for(const tuple of preferences.readers.slice(0,64)){
                    if(!Array.isArray(tuple)||tuple.length!==2)continue;const [key,value]=tuple;
                    if(typeof key==='string'&&value&&Number.isSafeInteger(value.cursor)&&Number.isSafeInteger(value.scroll))state.readers.set(key,value);
                }
                state.selectedKey=preferences.selectedKey;state.pin=preferences.pin===true;
                if(['Overview','Agents','Processes','Messages','Refs','To-do'].includes(preferences.tab))state.tab=preferences.tab;
            }
            const save=async()=>{await store.write('preferences',{selectedKey:state.selectedKey,pin:state.pin,tab:state.tab,collapsed:[...state.collapsed].slice(0,512),expanded:[...state.expanded].slice(0,512),readers:[...state.readers].slice(-64)});};
            cleanup=async()=>{ui.close();cache.close();try{await collector!.close();await save();}finally{rpc.close();await lease!.release();await admission.release();}};
            // The service owns its own admission check; do not hold a UI's gate
            // while waiting for its detached owner to start.
            await admission.release();
            const localSelection=()=>data.sessions.find(s=>(s.attachments??(s.attachment?[s.attachment]:[])).some(a=>a.tab_id===tabId))?.key;
            try {
                await collector.start();data=collector.data;
                if(!state.selectedKey||!data.sessions.some(s=>s.key===state.selectedKey))state.selectedKey=localSelection()??data.sessions[0]?.key;
                syncVisibility();await collector.refresh();data=collector.data;
                if(closing){await stop();return;}
                if(args.options.once||!process.stdin.isTTY){paint();await cleanup();return;}
                ui.start();
                const follow = async () => {
                    const snapshot=cache.snapshot;
                    if(!snapshot||state.pin||!context.settings.follow)return;
                    const focused=snapshot.agents.find(a=>a.pane_id===snapshot.focused_pane_id);
                    if(!focused||focused.tab_id!==tabId)return;
                    const selectedKey=followSelection.observe(snapshot,data,state.pin);
                    if(selectedKey){state.selectedKey=selectedKey;paint();}
                };
                cache.on('snapshot', () => { syncVisibility(); collector!.invalidate(); void follow(); });
                cache.on('stale', () => { collector!.setVisibleSession(state.selectedKey,false); data.stale = true; paint(); });
                collector.on('data', (next: DashboardData) => { data = next; if (!state.selectedKey || !data.sessions.some(s => s.key === state.selectedKey))
                    state.selectedKey = localSelection() ?? data.sessions[0]?.key; paint(); void follow(); });
                collector.on('diagnostic', (message: string) => { state.notice = message; paint(); });
                collector.once('disconnected',()=>void stop());
                ui.on('resize',paint);
                let referenceRequest=false;
                const perform = async (action: UiAction) => {
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
                        collector!.setScope(state.subtree);
                        return;
                    }
                    if (action.type === 'toggle-todo') {
                        await collector!.toggleTodo(action.sessionKey!, action.id!);
                        return;
                    }
                    if (action.type === 'copy') {
                        await copyText(action.text ?? '');
                        state.notice = 'Copy requested';
                        return;
                    }
                    if (action.type === 'open-ref') {
                        await openTarget(action.target!);
                        return;
                    }
                    if (action.type === 'export') {
                        const report = diagnosticExport(data);
                        const filename = path.join(context.serverStateDir, `export-${Date.now()}.txt`);
                        const { atomicWrite } = await import('../config/safe-file.ts');
                        await atomicWrite(filename, report);
                        state.notice = `Exported ${filename}`;
                        return;
                    }
                    if (action.type === 'settings') {
                        showDetail(state, JSON.stringify(context.settings, null, 2) + '\nUse the settings action --set KEY=JSON_VALUE to change persisted settings.');
                        return;
                    }
                    if (action.type === 'page-messages') {
                        const page = await collector!.pageMessages(action.sessionKey!, action.beforeId);
                        addMessagePage(state, action.sessionKey!, page);
                        state.notice = page.length ? `Loaded ${page.length} older messages` : 'No older messages available';
                        return;
                    }
                    if(action.type==='page-refs'||action.type==='ref-sources'){
                        const key=action.sessionKey!,session=data.sessions.find(session=>session.key===key);if(!session||referenceRequest)return;referenceRequest=true;
                        try{const revision=session.evidence.contentRevision;
                            if(action.type==='page-refs'){
                                const excluded=[...(session.refs??[]),...(!action.restart?state.pagedRefs.get(key)?.refs??[]:[])].map(ref=>ref.id);
                                const page=await collector!.pageReferences(key,{cursor:action.referencePageCursor,excludeIds:excluded,limit:50});
                                if(page&&!closing&&state.selectedKey===key&&state.tab==='Refs'&&!state.refSources){if(action.restart)state.pagedRefs.delete(key);addReferencePage(state,key,page,page.contentRevision??revision);state.notice=page.refs.length?undefined:'No older reference targets';}
                            }else{
                                const reader=state.refSources,reference=reader&&reader.reference.id===action.id?reader.reference:visibleReferences(session,state).find(ref=>ref.id===action.id);if(!reference)return;
                                const page=await collector!.pageReferenceSources(key,reference.id,{cursor:action.referencePageCursor,limit:50});
                                if(page&&!closing&&state.selectedKey===key&&state.tab==='Refs')showReferenceSources(state,key,reference,page,page.contentRevision??revision,Boolean(action.referencePageCursor)&&!action.restart);
                            }
                        }finally{referenceRequest=false;}return;
                    }
                    if (action.type === 'focus') {
                        const selected = data.sessions.find(s => s.key === action.sessionKey);
                        if (!selected)
                            return;
                        state.selectedKey = selected.key;
                        if (selected.attachment) {
                            await collector!.focus(selected.key);
                        }
                        else {
                            state.tab = 'Messages';
                            state.cursor = 0;
                            state.cursorId = undefined;
                        }
                        return;
                    }
                    if (action.type === 'source') {
                        const message = action.referenceCursor?await collector!.referenceMessage(action.referenceCursor):await collector!.message(action.sessionKey!, action.id!);
                        if(closing||state.selectedKey!==action.sessionKey)return;
                        showDetail(state, message ? `${message.role}\n${message.text}` : 'Source message unavailable');
                        return;
                    }
                    if (action.type === 'message') {
                        const message = action.id && action.sessionKey ? await collector!.message(action.sessionKey, action.id) : undefined;
                        const text = message ? `${message.role}\n${message.text}\n${(message.tools ?? []).map(t => `${t.status} ${t.name}: ${t.summary ?? ''}`).join('\n')}` : action.text ?? 'No detail';
                        if (message && action.sessionKey) {
                            try {
                                await rpc.call('plugin.pane.open', { plugin_id: 'iob.herdr-prism', entrypoint: 'detail', placement: 'popup', env: { ...(process.platform==='win32'?windowsPaneEnvironment():{}), HAT_DETAIL_SESSION: action.sessionKey, HAT_DETAIL_MESSAGE: action.id! }, focus: true });
                                return;
                            }
                            catch { /* ui_busy or unsupported popup uses the in-panel detail. */ }
                        }
                        showDetail(state, text);
                        return;
                    }
                };
                ui.on('input', async (event: any) => { try {
                    if (event.type === 'mouse') {
                        if (event.release)
                            return;
                        if (event.y === 3 && event.button === 0 && ui.columns >= 65) {
                            const { tabs } = await import('../tui/types.ts');
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
                    state.notice = (error as Error).message;
                    if (!closing)
                        paint();
                } });
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
    async function stop() { if (stopping)
        return stopping; closing = true; collector?.setVisibleSession(state.selectedKey,false); stopping = cleanup().finally(() => { finished = true; }); return stopping; }
    if (args.options.demo)
        ui.on('input', async (event: any) => { if (event.type !== 'key')
            return; const action = handleKey(state, event.key, data, frame); if (action?.type === 'quit')
            await stop();
        else if (action?.type === 'focus')
            state.selectedKey = action.sessionKey;
        else if (action?.type === 'message')
            showDetail(state, action.text ?? '');
        else if(action?.type==='ref-sources'){
            const session=data.sessions.find(session=>session.key===action.sessionKey),reference=session?.refs?.find(ref=>ref.id===action.id);if(reference)showReferenceSources(state,session!.key,reference,{sources:reference.sources??[{messageId:reference.messageId,source:reference.source}],hasMore:false,partial:true,observedAt:Date.now()},session!.evidence.contentRevision);
        }
        else if(action?.type==='page-refs')state.notice='Demo has no additional reference history';
        else if(action?.type==='source'){
            const session=data.sessions.find(session=>session.key===action.sessionKey),message=session?.evidence.messages.find(message=>message.id===action.id);showDetail(state,message?`Demo source\n${message.text}`:'Demo source unavailable');
        }
        else if (action?.type === 'scope')
            state.notice = 'Demo fixture scopes';
        else if (action?.type === 'toggle-todo') {
            const session = data.sessions.find(s => s.key === action.sessionKey);
            const todo = session?.todos?.find(t => t.id === action.id);
            if (todo)
                todo.checked = !todo.checked;
        } if (!closing)
            paint(); });
    process.once('SIGINT', () => void stop());
    process.once('SIGTERM', () => void stop());
    process.stdin.once('end', () => void stop());
    await new Promise<void>(resolve => { const check = setInterval(() => { if (finished) {
        clearInterval(check);
        resolve();
    } }, 100); });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
