import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {rm} from 'node:fs/promises';
import {freshPrivateDirectory} from './helpers/private-dir.ts';
import {Collector} from '../src/runtime/collector.ts';
import {CollectorHost} from '../src/runtime/collector-service.ts';
import {StateStore} from '../src/state/store.ts';
import {processKey} from '../src/process/ledger.ts';
import {createUiState,renderScreen,handleKey,handleRowClick,showDetail} from '../src/tui/screen.ts';
import {demoData} from '../src/runtime/demo.ts';
import {createSampler} from '../src/process/sampler.ts';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {access} from 'node:fs/promises';

function uiFixture(){const data=demoData(),state=createUiState();state.tab='Processes';state.selectedKey=data.sessions[0]!.key;state.cursorId=data.sessions[0]!.resource!.processes[1]!.key;return {data,state};}
test('K captures a process and confirmation defaults to Cancel, preserving the reader',()=>{
 const {data,state}=uiFixture();let frame=renderScreen(data,state,50,24);const before={cursor:state.cursor,cursorId:state.cursorId,scroll:state.scroll};
 assert.equal(handleKey(state,'K',data,frame),undefined);assert.ok((state as any).processConfirmation);
 frame=renderScreen(data,state,50,24);assert.equal(frame.rows[state.cursor]?.id,'process-cancel');assert.match(frame.lines.join('\n'),/Cancel/);
 assert.equal(handleKey(state,'enter',data,frame),undefined);assert.equal((state as any).processConfirmation,undefined);
 renderScreen(data,state,50,24);assert.deepEqual({cursor:state.cursor,cursorId:state.cursorId,scroll:state.scroll},before);
});
test('confirmation is frozen, blocks tab/focus/scope changes, supports help and requires explicit confirmation',()=>{
 const {data,state}=uiFixture();let frame=renderScreen(data,state,80,34);handleKey(state,'K',data,frame);frame=renderScreen(data,state,80,34);
 const captured=structuredClone((state as any).processConfirmation?.target);assert.ok(captured);
 for(const key of ['tab','u','p','f','K','1'])assert.equal(handleKey(state,key,data,frame),undefined);
 assert.equal(state.tab,'Processes');assert.equal(state.subtree,false);assert.equal(state.pin,false);
 const tab=frame.tabRegions!.find(r=>r.tab==='Agents')!;assert.equal(handleRowClick(state,tab.x,tab.y,data,frame),undefined);assert.equal(state.tab,'Processes');
 handleKey(state,'?',data,frame);assert.equal(state.help,true);frame=renderScreen(data,state,80,34);assert.equal(handleKey(state,'y',data,frame),undefined);
 handleKey(state,'escape',data,frame);frame=renderScreen(data,state,80,34);
 data.sessions[0]!.resource!.processes.reverse();frame=renderScreen(data,state,80,34);
 const action=handleKey(state,'y',data,frame) as any;assert.equal(action?.type,'terminate-process');assert.deepEqual(action.processTarget,captured);assert.equal((state as any).processConfirmation,undefined);
});
test('process details expose K and cancellation restores details; other facts cannot terminate',()=>{
 const {data,state}=uiFixture();let frame=renderScreen(data,state,50,24);const action=handleKey(state,'enter',data,frame)!;showDetail(state,action.text??'',action.document);frame=renderScreen(data,state,50,24);
 const document=state.detailDocument;handleKey(state,'K',data,frame);frame=renderScreen(data,state,50,24);assert.ok((state as any).processConfirmation);handleKey(state,'escape',data,frame);assert.equal(state.detailDocument,document);
 handleKey(state,'escape',data,renderScreen(data,state,50,24));state.cursorId='scope';frame=renderScreen(data,state,50,24);handleKey(state,'K',data,frame);assert.equal((state as any).processConfirmation,undefined);
});
test('a tiny confirmation cannot accept y or Enter on the destructive action',()=>{
 const {data,state}=uiFixture();handleKey(state,'K',data,renderScreen(data,state,50,24));let frame=renderScreen(data,state,20,8);
 assert.equal(handleKey(state,'y',data,frame),undefined);assert.ok(state.processConfirmation);
 state.cursorId='process-confirm';frame=renderScreen(data,state,20,8);assert.equal(handleKey(state,'enter',data,frame),undefined);assert.ok(state.processConfirmation);
 handleKey(state,'escape',data,frame);assert.equal(state.processConfirmation,undefined);
});

async function collectorFixture(t:any,childPid=42001){
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-terminate-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const agent={pane_id:'agent',terminal_id:'agent-term',workspace_id:'w',tab_id:'tab',agent:'codex',agent_status:'working',agent_session:{kind:'id',value:'a'},focused:true,revision:1};
 const evidence={id:'a',provider:'codex',messages:[],tools:[],usage:[],goals:[],availability:'known'};
 const control={boot:'boot',start:'2',ownerChanged:false,fail:false,missing:false,denied:false,old:false,foreground:true,signals:[] as any[],samples:0};
 const rpc={async call(method:string){if(method==='session.snapshot')return{snapshot:{protocol:22,agents:[agent]}};if(method==='agent.get')return{agent:control.ownerChanged?{...agent,agent_session:{kind:'id',value:'replacement'}}:agent};if(method==='pane.process_info')return{process_info:{foreground_processes:control.foreground?[{pid:42000,name:'codex'}]:[]}};return{};}};
 const index={setActiveRefs(){},setDetailedRefs(){},async refreshSnapshots(){return[evidence];},resolveSnapshotCached(){return evidence;},diagnostics:[],close(){}};
 const sampler={async sample(){control.samples++;if(control.fail)throw Error('sampler failed');return{version:1 as const,platform:'linux',bootId:control.boot,sampledAt:control.old?1:Date.now(),monotonicNs:String(control.samples*1000000),processes:[{pid:42000,ppid:1,startTime:'1',cpuNs:'0',rssBytes:'100',name:'codex'},...control.missing?[]:[{pid:childPid,ppid:42000,startTime:control.start,cpuNs:'0',rssBytes:'100',name:'worker',availability:control.denied?'unavailable' as const:'known' as const}]],errors:[]};},async close(){}};
 const collector=new Collector({rpc:rpc as any,index:index as any,sampler,git:{close(){}} as any,stateDir:directory,paneOpen:true,visibleSession:'codex:a',settings:{nativeMode:'inspector-only',providerHomes:{},todosEnabled:false,sampleIntervalMs:2000,follow:false,ascii:true,monochrome:true} as any,signalProcess:(pid:number,signal:string)=>{control.signals.push({pid,signal});}} as any);
 t.after(()=>collector.close({clearNative:false}));await collector.init();await collector.refresh();await collector.sampleProcesses();
 return{collector,control,key:processKey('boot',childPid,'2')};
}
test('termination rechecks a fresh exact birth/boot/owner then signals only the selected PID',async t=>{
 const {collector,control,key}=await collectorFixture(t);await (collector as any).terminateProcess('codex:a',{key,owner:'codex:a'},async()=>{});
 assert.deepEqual(control.signals,[{pid:42001,signal:'SIGTERM'}]);assert.ok(control.samples>=3);
});
for(const scenario of ['birth','boot','missing','denied','owner','sampler','hidden','guard'] as const)test('termination refuses '+scenario+' changes without sending a signal',async t=>{
 const {collector,control,key}=await collectorFixture(t);
 if(scenario==='birth')control.start='3';if(scenario==='boot')control.boot='new';if(scenario==='missing')control.missing=true;if(scenario==='denied')control.denied=true;if(scenario==='owner')control.ownerChanged=true;if(scenario==='sampler')control.fail=true;if(scenario==='hidden')collector.setVisibleSession('codex:a',false);
 await assert.rejects((collector as any).terminateProcess('codex:a',{key,owner:'codex:a'},async()=>{if(scenario==='guard')throw Error('View disappeared');}));assert.deepEqual(control.signals,[]);
});
test('broker requires the registered visible panel and matching selection before requesting termination',async t=>{
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-terminate-view-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=new StateStore(directory);await store.write('views',[{tabId:'tab',paneId:'prism',terminalId:'view',open:true}]);
 let panes:any[]=[{pane_id:'prism',terminal_id:'view',tab_id:'tab'}],calls=0;
 const collector={data:{sessions:[]},setVisibleSession(){},setScope(){},setProcessesExpanded(){},async terminateProcess(_session:any,_target:any,guard:any){await guard();calls++;return{requested:true};}};
 const rpc={call:async()=>({snapshot:{panes,focused_tab_id:'tab'}})},host=new CollectorHost(collector as any,store,rpc as any);
 const p={terminalId:'view',session:'session',processTarget:{key:'key',owner:'session'}};
 await assert.rejects(host.request('terminate-process',p));assert.equal(calls,0);
 await host.request('view.poll',{terminalId:'view',key:'session',visible:true,subtree:false,expanded:true});
 await assert.rejects(host.request('terminate-process',{...p,session:'other'}));await assert.rejects(host.request('terminate-process',{...p,terminalId:'foreign'}));
 await host.request('terminate-process',p);assert.equal(calls,1);panes=[];await assert.rejects(host.request('terminate-process',p));assert.equal(calls,1);
});

const helper=process.env.HAT_NATIVE_HELPER??'native/sampler/target/debug/hat-sampler';
const canSample=process.platform==='linux'||await access(helper).then(()=>true,()=>false);
test('real OS sampler: cancel leaves an isolated worker alive; confirmed termination ends only that worker',{skip:!canSample,timeout:20000},async t=>{
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-terminate-live-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const worker=spawn(process.execPath,['-e','console.log("ready");setInterval(()=>{},1000)'],{stdio:['ignore','pipe','pipe']});worker.stderr!.resume();
 const exited=once(worker,'exit');t.after(async()=>{if(worker.exitCode===null&&worker.signalCode===null)worker.kill();await exited;});await once(worker.stdout!,'data');
 const sampler=createSampler({helperPath:helper});t.after(()=>sampler.close());
 const agent={pane_id:'fixture',terminal_id:'fixture-term',workspace_id:'w',tab_id:'tab',agent:'codex',agent_status:'working',agent_session:{kind:'id',value:'fixture'},revision:1};
 const evidence={id:'fixture',provider:'codex',messages:[],tools:[],usage:[],goals:[],availability:'known'};
 const rpc={async call(method:string){if(method==='session.snapshot')return{snapshot:{protocol:22,agents:[agent]}};if(method==='agent.get')return{agent};if(method==='pane.process_info')return{process_info:{foreground_processes:[{pid:worker.pid,name:'codex'}]}};return{};}};
 const index={setActiveRefs(){},setDetailedRefs(){},async refreshSnapshots(){return[evidence];},resolveSnapshotCached(){return evidence;},diagnostics:[],close(){}};
 const collector=new Collector({rpc:rpc as any,index:index as any,sampler,git:{close(){}} as any,stateDir:directory,paneOpen:true,visibleSession:'codex:fixture',settings:{nativeMode:'inspector-only',providerHomes:{},todosEnabled:false,sampleIntervalMs:2000,follow:false,ascii:true,monochrome:true} as any});t.after(()=>collector.close({clearNative:false}));
 await collector.init();await collector.refresh();await collector.sampleProcesses();const sampledProcess=collector.data.sessions[0]!.resource!.processes.find(p=>p.pid===worker.pid);assert.ok(sampledProcess,'isolated worker must have a verified sampled identity');
 const state=createUiState();state.tab='Processes';state.selectedKey='codex:fixture';state.cursorId=sampledProcess.key;let frame=renderScreen(collector.data,state,80,34);
 handleKey(state,'K',collector.data,frame);frame=renderScreen(collector.data,state,80,34);assert.equal(handleKey(state,'enter',collector.data,frame),undefined);assert.doesNotThrow(()=>globalThis.process.kill(worker.pid!,0));
 handleKey(state,'K',collector.data,renderScreen(collector.data,state,80,34));frame=renderScreen(collector.data,state,80,34);const action=handleKey(state,'y',collector.data,frame)!;assert.equal(action.type,'terminate-process');
 const result=await collector.terminateProcess(action.sessionKey!,action.processTarget!,async()=>{});assert.equal(result.pid,worker.pid);await exited;assert.throws(()=>globalThis.process.kill(worker.pid!,0));assert.ok(globalThis.process.pid>0,'test harness remains alive');
});

test('ownership replaced while checking panel visibility is refused before signaling',async t=>{
 const {collector,control,key}=await collectorFixture(t);await assert.rejects(collector.terminateProcess('codex:a',{key,owner:'codex:a'},async()=>{control.ownerChanged=true;}));assert.deepEqual(control.signals,[]);
});

test('view disappearing during the final process scan is refused',async t=>{
 const {collector,control,key}=await collectorFixture(t);let checks=0;
 await assert.rejects(collector.terminateProcess('codex:a',{key,owner:'codex:a'},async()=>{if(++checks===2)throw Error('View disappeared during scan');}));assert.deepEqual(control.signals,[]);
});
test('old process samples cannot authorize a termination',async t=>{
 const {collector,control,key}=await collectorFixture(t);control.old=true;
 await assert.rejects(collector.terminateProcess('codex:a',{key,owner:'codex:a'},async()=>{}));assert.deepEqual(control.signals,[]);
});

test('children of a validated launch remain terminable without a live harness pane root',async t=>{
 const {collector,control,key}=await collectorFixture(t);await collector.recordLaunch({id:'launch',sessionKey:'codex:a',pid:42000,startTime:'1',bootId:'boot'});control.foreground=false;
 await collector.terminateProcess('codex:a',{key,owner:'codex:a'},async()=>{});assert.deepEqual(control.signals,[{pid:42001,signal:'SIGTERM'}]);
});

for(const [label,pid]of [['system',1],['collector',process.pid],['collector parent',process.ppid]] as const)test('refuses protected '+label+' PID',async t=>{
 const {collector,control,key}=await collectorFixture(t,pid);await assert.rejects(collector.terminateProcess('codex:a',{key,owner:'codex:a'},async()=>{}));assert.deepEqual(control.signals,[]);
});
test('a foreign owner or arbitrary key cannot request a signal',async t=>{
 const {collector,control,key}=await collectorFixture(t);await assert.rejects(collector.terminateProcess('codex:a',{key,owner:'foreign'},async()=>{}));await assert.rejects(collector.terminateProcess('codex:a',{key:'arbitrary',owner:'codex:a'},async()=>{}));assert.deepEqual(control.signals,[]);
});
