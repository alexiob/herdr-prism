import {NotesController} from '../tui/notes.ts';
import {NotesStore} from '../state/notes.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArguments } from '../runtime/actions.ts';
import { serviceContext } from '../runtime/service.ts';
import { acquireAdmission } from '../runtime/admission.ts';
import { FollowSelection, inspectorVisible, localSelection as selectLocal } from '../runtime/follow.ts';
import { RemoteCollector } from '../runtime/remote-collector.ts';
import {panelViewStore} from '../runtime/panel-views.ts';
import { demoData } from '../runtime/demo.ts';
import { HerdrClient } from '../herdr/client.ts';
import { SnapshotCache } from '../herdr/subscription.ts';
import { StateStore } from '../state/store.ts';
import { TerminalUi } from '../tui/terminal.ts';
import { createUiState, renderScreen, handleKey, handleRowClick, showDetail, addMessagePage, addReferencePage, showReferenceSources } from '../tui/screen.ts';
import {messageDocument} from '../tui/facts.ts';
import {visibleReferences} from '../tui/reference-readers.ts';
import { diagnosticExport } from '../tui/export.ts';
import { copyText, openTarget } from '../tui/platform.ts';
import {tabs} from '../tui/types.ts';
import type { DashboardData, RenderedScreen, UiAction } from '../tui/types.ts';
export async function main(argv = process.argv.slice(2)) {
    const args = parseArguments(['inspector', ...argv]);
    const state = createUiState();
    state.ascii = args.options.ascii === true;
    state.monochrome = args.options.monochrome === true;
    if(args.options.theme){if(!['dark','light','mono'].includes(String(args.options.theme)))throw new Error('Theme must be dark, light or mono');state.theme=args.options.theme as any;}
    const ui = new TerminalUi({ monochrome: state.monochrome });
    let data: DashboardData;
    let frame: RenderedScreen;
    let cleanup: () => Promise<void> = async () => { ui.close(); };
    let collector: RemoteCollector | undefined;
    let closing = false;
    let finished = false;
    let stopping: Promise<void> | undefined;
    let syncVisibility = () => {};let panelVisible=()=>true;
    let notes:NotesController|undefined;
    let inputQueue=Promise.resolve();
    const ensureNotes=async(reload=false)=>{if(state.tab!=='Notes'||!state.selectedKey||notes?.value?.editing||!panelVisible())return;const session=data.sessions.find(s=>s.key===state.selectedKey);if(!session||!notes)return;const changed=notes.value?.sessionKey!==session.key;await notes.open(session.key,session.evidence.title??session.evidence.id,reload);if(changed)state.notesScroll=0;state.notes=notes.value;};
    const connectNotes=(dir:string)=>{notes=new NotesController(new NotesStore(dir));notes.on('change',()=>{state.notes=notes!.value;if(!closing)paint();});};
    const editorInput=async(event:any)=>{
        if(!notes?.value?.editing)return false;
        if(event.type==='paste'){if(event.overflow)state.notice='Paste exceeds 1 MiB; nothing inserted';else notes.paste(event.text,{columns:ui.columns,height:ui.rows,tabOrder:state.tabOrder});return true;}
        if(event.type==='mouse'){if(event.release)return true;const tab=frame.tabRegions?.find(r=>r.y===event.y&&event.x>=r.x&&event.x<r.x+r.width);if(!tab)return true;await notes.end();return false;}
        if(event.key==='ctrl+s'){await notes.flush();return true;}
        if(event.key==='escape'){await notes.end();return true;}
        if(['tab','shift+tab','ctrl+c'].includes(event.key)){await notes.end();return false;}
        return notes.key(event.key,{columns:ui.columns,height:ui.rows,tabOrder:state.tabOrder});
    };
    const paint = () => { syncVisibility(); frame = renderScreen(data, state, ui.columns, ui.rows); ui.paint(frame); };
    if (args.options.demo) {
        data = demoData();
        state.selectedKey = data.sessions[0]?.key;
        if (args.options.view && tabs.includes(String(args.options.view) as any))
            state.tab = args.options.view as any;
        if (args.options.once || !process.stdin.isTTY) {
            paint();
            return;
        }
        const demoDir=await mkdtemp(path.join(tmpdir(),'prism-demo-notes-'));connectNotes(demoDir);cleanup=async()=>{await notes!.close();ui.close();await rm(demoDir,{recursive:true,force:true});};await ensureNotes();
        ui.on('resize', paint);
        ui.start();
        paint();
    }
    else {
        state.restrictAutomaticSelection=true;
        const context = await serviceContext(args.options);
        state.theme??=context.settings.theme;
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
            panelVisible=()=>!closing&&!cache.stale&&inspectorVisible(cache.snapshot,terminalId,paneId);
            syncVisibility = () => {
                const visible=panelVisible();
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
                if(tabs.includes(preferences.tab))state.tab=preferences.tab;
            }
            const save=async()=>{await store.write('preferences',{selectedKey:state.selectedKey,pin:state.pin,tab:state.tab,collapsed:[...state.collapsed].slice(0,512),expanded:[...state.expanded].slice(0,512),readers:[...state.readers].slice(-64)});};
            cleanup=async()=>{await notes?.close();ui.close();cache.close();try{await collector!.close();await save();}finally{rpc.close();await lease!.release();await admission.release();}};
            // The service owns its own admission check; do not hold a UI's gate
            // while waiting for its detached owner to start.
            await admission.release();
            const localSelection=()=>selectLocal(data,tabId,cache.snapshot);
            try {
                await collector.start();data=collector.data;
                if(!state.pin||!state.selectedKey||!data.sessions.some(s=>s.key===state.selectedKey))state.selectedKey=localSelection();
                syncVisibility();await collector.refresh();data=collector.data;
                if(closing){await stop();return;}
                if(args.options.once||!process.stdin.isTTY){paint();await cleanup();return;}
                connectNotes(context.serverStateDir);await ensureNotes();ui.start();
                const follow = async () => {
                    const snapshot=cache.snapshot;
                    if(!snapshot||state.pin||state.processConfirmation||state.notes?.editing||!context.settings.follow)return;
                    const focused=snapshot.agents.find(a=>a.pane_id===snapshot.focused_pane_id);
                    if(!focused||focused.tab_id!==tabId)return;
                    const selectedKey=followSelection.observe(snapshot,data,state.pin);
                    if(selectedKey){await notes?.end();state.selectedKey=selectedKey;await ensureNotes();paint();}
                };
                const queueFollow=()=>{inputQueue=inputQueue.then(async()=>{if(!closing){await ensureNotes();await follow();paint();}}).catch(error=>{state.notice=(error as Error).message;if(!closing)paint();});};
                cache.on('snapshot', () => { syncVisibility(); collector!.invalidate(); queueFollow(); });
                cache.on('stale', () => { collector!.setVisibleSession(state.selectedKey,false); data.stale = true; paint(); });
                collector.on('data', (next: DashboardData) => { data = next; if (!state.processConfirmation&&!state.notes?.editing&&(!state.selectedKey || !data.sessions.some(s => s.key === state.selectedKey)))
                    state.selectedKey = localSelection(); paint(); queueFollow(); });
                collector.on('diagnostic', (message: string) => { state.notice = message; paint(); });
                collector.once('disconnected',()=>{inputQueue=inputQueue.then(()=>stop());});
                ui.on('resize',paint);
                let referenceRequest=false;let contentRequest=0;
                const perform = async (action: UiAction) => {
                    if (action.type === 'quit'){contentRequest++;return stop();}
                    if (action.type === 'pin') {
                        await save();
                        if (!state.pin) {
                            followSelection.reset();
                            await follow();
                        }
                        return;
                    }
                    if(action.type==='terminate-process'){const result=await collector!.terminateProcess(action.sessionKey!,action.processTarget!);state.notice=`${result.platform==='win32'?'Termination':'SIGTERM'} requested for PID ${result.pid}`;return;}
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
                    if(action.type==='tab'){contentRequest++;await notes?.end();await ensureNotes();return;}
                    if(action.type==='notes-edit'){await ensureNotes(true);if(notes&&notes.value?.sessionKey===state.selectedKey)notes.begin({columns:ui.columns,height:ui.rows,tabOrder:state.tabOrder});state.notice=undefined;return;}
                    if(action.type==='select'){await notes?.end();contentRequest++;const selected=data.sessions.find(session=>session.key===action.sessionKey);if(selected){state.selectedKey=selected.key;state.tab='Overview';state.cursor=0;state.cursorId=undefined;state.scroll=0;syncVisibility();collector!.invalidate();}return;}
                    if (action.type === 'focus') {
                        await notes?.end();
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
                        const request=++contentRequest,tab=state.tab;
                        const message = action.referenceCursor?await collector!.referenceMessage(action.referenceCursor):await collector!.message(action.sessionKey!, action.id!);
                        if(closing||state.selectedKey!==action.sessionKey||state.tab!==tab||request!==contentRequest)return;
                        showDetail(state, message ? `${message.role}\n${message.text}` : 'Source message unavailable',message?messageDocument(message):undefined);
                        return;
                    }
                    if (action.type === 'message') {
                        const request=++contentRequest,tab=state.tab,key=state.selectedKey;
                        const message = action.id && action.sessionKey ? await collector!.message(action.sessionKey, action.id) : undefined;
                        if(closing||key!==state.selectedKey||tab!==state.tab||request!==contentRequest)return;
                        const text = message ? `${message.role}\n${message.text}\n${(message.tools ?? []).map(t => `${t.status} ${t.name}: ${t.summary ?? ''}`).join('\n')}` : action.text ?? 'No detail';
                        showDetail(state, text, action.document??(message?messageDocument(message):undefined));
                        return;
                    }
                };
                const processInput=async (event:any)=>{try{
                    if(await editorInput(event)){paint();if(!state.notes?.editing)await follow();return;}
                    if (event.type === 'mouse') {
                        if (event.release)
                            return;
                        if (event.button === 64 || event.button === 65) {
                            state.cursor += event.button === 64 ? -3 : 3;
                            state.cursorId = undefined;
                        }
                        else if (event.button === 0) {
                            const action = handleRowClick(state, event.x, event.y, data, frame);
                            if (action)
                                await perform(action);
                        }
                    }
                    else if(event.type==='key'){
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
                }};
                ui.on('input',(event:any)=>{if(!closing)inputQueue=inputQueue.then(()=>processInput(event));});
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
        return stopping; closing = true; collector?.setVisibleSession(state.selectedKey,false); stopping=cleanup().then(()=>{finished=true;}).catch(error=>{closing=false;stopping=undefined;state.notice='Cannot close until notes are saved: '+(error as Error).message;paint();}); return stopping; }
    if (args.options.demo){
        const demoInput=async(event:any)=>{try{if(await editorInput(event)){paint();return;}if (event.type !== 'key')
            return; const action = handleKey(state, event.key, data, frame); if (action?.type === 'quit')
            await stop();
        else if (action?.type === 'focus'||action?.type==='select')
            {state.selectedKey = action.sessionKey;if(action.type==='select')state.tab='Overview';}
        else if(action?.type==='terminate-process')state.notice=`Demo: simulated termination of PID ${action.processTarget!.pid}; no OS signal sent`;
        else if(action?.type==='tab')await ensureNotes();
        else if(action?.type==='notes-edit'){await ensureNotes(true);if(notes&&notes.value?.sessionKey===state.selectedKey)notes.begin({columns:ui.columns,height:ui.rows,tabOrder:state.tabOrder});}
        else if (action?.type === 'message')
            showDetail(state, action.text ?? '',action.document);
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
            paint();}catch(error){state.notice=(error as Error).message;paint();}};
        ui.on('input',(event:any)=>{if(!closing)inputQueue=inputQueue.then(()=>demoInput(event));});
    }
    process.once('SIGINT', () => {inputQueue=inputQueue.then(()=>stop());});
    process.once('SIGTERM', () => {inputQueue=inputQueue.then(()=>stop());});
    process.stdin.once('end', () => {inputQueue=inputQueue.then(()=>stop());});
    await new Promise<void>(resolve => { const check = setInterval(() => { if (finished) {
        clearInterval(check);
        resolve();
    } }, 100); });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
