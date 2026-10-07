import {test} from 'node:test';import assert from 'node:assert/strict';import {freshPrivateDirectory} from './helpers/private-dir.ts';import {rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Collector} from '../src/runtime/collector.ts';import {processKey} from '../src/process/ledger.ts';
async function fixture(t:any){const dir=await freshPrivateDirectory(join(tmpdir(),'prism-output-'));t.after(()=>rm(dir,{recursive:true,force:true}));let changed=false,reads=0;let block:Promise<void>|undefined;let outputText="build started\nchild output\nfinished\n";
 const agent:any={pane_id:'agent',terminal_id:'terminal',tab_id:'tab',agent:'codex',agent_status:'working',agent_session:{kind:'id',value:'s'}};
 const rpc:any={call:async(method:string,params:any)=>{if(method==='session.snapshot')return{snapshot:{protocol:22,agents:[agent]}};if(method==='agent.get')return{agent:changed?{...agent,terminal_id:'replacement'}:agent};if(method==='pane.process_info')return{process_info:{foreground_processes:[{pid:42000,name:'codex'}]}};if(method==='pane.read'){if(params.source!=='recent_unwrapped')return{};reads++;assert.equal(params.source,'recent_unwrapped');assert.equal(params.lines,200);if(block)await block;return{read:{pane_id:'agent',source:'recent_unwrapped',format:'text',text:outputText}};}return{};}};
 let n=0;const sampler={sample:async()=>({platform:'linux',bootId:'b',sampledAt:Date.now(),monotonicNs:String(++n*1000000000),processes:[{pid:42000,ppid:1,startTime:'1',cpuNs:'0',rssBytes:'1',name:'codex'},{pid:42001,ppid:42000,startTime:'2',cpuNs:'0',rssBytes:'1',name:'job'}]}),close:async()=>{}};
 const collector=new Collector({rpc,index:{setActiveRefs(){},setDetailedRefs(){},resolveSnapshotCached(){},refreshSnapshots:async()=>[],diagnostics:[],close(){}} as any,sampler,git:{close(){}} as any,stateDir:dir,paneOpen:true,visibleSession:'codex:s',settings:{nativeMode:'inspector-only',providerHomes:{},todosEnabled:false,sampleIntervalMs:2000,follow:false,ascii:false,monochrome:true}});
 t.after(()=>collector.close());await collector.init();await collector.refresh();await collector.sampleProcesses();return{collector,target:{key:processKey('b',42001,'2'),owner:'codex:s'},get reads(){return reads;},setText(text:string){outputText=text;},replace(){changed=true;},block(p:Promise<void>){block=p;}};
}
test('verified process detail can read retained shared terminal output without claiming PID-isolated stdout',async t=>{
 const f=await fixture(t),c=f.collector as any;assert.equal(typeof c.processOutput,'function');let guards=0;const out=await c.processOutput('codex:s',f.target,async()=>{guards++;});assert.equal(out.availability,'known');assert.equal(out.scope,'shared-terminal');assert.match(out.text,/child output/);assert.equal(out.paneId,'agent');assert.equal(out.pid,42001);assert.equal(f.reads,1);assert.ok(guards>=2);
});
test('hidden, foreign, reused and replaced targets cannot read terminal output',async t=>{
 const f=await fixture(t),c=f.collector as any;assert.equal(typeof c.processOutput,'function');assert.equal(await c.processOutput('codex:s',{...f.target,key:processKey('b',42001,'9')},async()=>{}),undefined);assert.equal(await c.processOutput('codex:s',{...f.target,owner:'codex:other'},async()=>{}),undefined);f.replace();assert.equal(await c.processOutput('codex:s',f.target,async()=>{}),undefined);assert.equal(f.reads,0);f.collector.setVisibleSession('codex:s',false);assert.equal(await c.processOutput('codex:s',f.target,async()=>{}),undefined);
});
test('closing during a terminal read suppresses the late output result',async t=>{
 const f=await fixture(t),c=f.collector as any;assert.equal(typeof c.processOutput,'function');let release!:()=>void;f.block(new Promise<void>(r=>release=r));const pending=c.processOutput('codex:s',f.target,async()=>{});while(!f.reads)await new Promise(r=>setTimeout(r,1));f.collector.setVisibleSession('codex:s',false);release();assert.equal(await pending,undefined);
});
import {withProcessOutput} from '../src/process/output.ts';import {processDocument} from '../src/tui/facts.ts';import {demoData} from '../src/runtime/demo.ts';import {createUiState,renderScreen,handleKey,showDetail} from '../src/tui/screen.ts';import {documentText} from '../src/tui/widgets.ts';
test('process details expose an Output panel and r requests a fresh snapshot for that exact process',()=>{
 const data=demoData(),session=data.sessions[0]!,process=session.resource!.processes[0]!,state=createUiState();state.selectedKey=session.key;state.tab='Processes';const doc=processDocument(session,process,Date.now());assert.ok(doc.sections.find(s=>s.id==='output'));showDetail(state,documentText(doc),doc);
 const frame=renderScreen(data,state,80,34);const action=handleKey(state,'r',data,frame)!;assert.equal(action.type,'process-output');assert.equal(action.processTarget!.key,process.key);assert.equal(action.sessionKey,session.key);
 const loaded=withProcessOutput(doc,{availability:'known',scope:'shared-terminal',pid:process.pid,owner:process.owner,processKey:process.key,capturedAt:Date.now(),text:'line one\nline two'});assert.match(loaded.sections.find(s=>s.id==='output')!.text!,/line two/);assert.match(loaded.sections.find(s=>s.id==='output')!.title,/shared terminal/);assert.ok(loaded.sections.find(s=>s.id==='output-provenance'));
});

test('retained output is bounded and strips terminal controls before display',async t=>{
 const f=await fixture(t);f.setText('x'.repeat(70000)+'\x1b[31mRED\x1b[0m\x1b]52;c;secret\x07\x00end');
 const out=await f.collector.processOutput('codex:s',f.target,async()=>{});assert.equal(out?.truncated,true);assert.ok(Buffer.byteLength(out!.text!)<=65536);assert.match(out!.text!,/REDend$/);assert.doesNotMatch(out!.text!,/secret|\x1b|\x00/);
});
test('output refresh samples immediately after the displayed scope changes',async t=>{
 const f=await fixture(t);f.collector.setVisibleSelections([{key:'codex:s',subtree:true,expanded:true}]);
 const out=await f.collector.processOutput('codex:s',f.target,async()=>{},true);assert.equal(out?.availability,'known');assert.equal(f.reads,1);
});

import {CollectorHost} from '../src/runtime/collector-service.ts';import {StateStore} from '../src/state/store.ts';
test('output broker requires its registered visible view and forwards the caller scope independently',async t=>{
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-output-view-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=new StateStore(directory);
 await store.write('views',[{tabId:'tab',paneId:'prism-a',terminalId:'view-a',open:true},{tabId:'tab',paneId:'prism-b',terminalId:'view-b',open:true}]);
 let panes:any[]=[{pane_id:'prism-a',terminal_id:'view-a',tab_id:'tab'},{pane_id:'prism-b',terminal_id:'view-b',tab_id:'tab'}],scopes:boolean[]=[];
 const collector={data:{sessions:[]},setVisibleSelections(){},dataForView(){return this.data;},async processOutput(_session:any,_target:any,guard:any,subtree:boolean){await guard();scopes.push(subtree);return{availability:'known'};}};
 const rpc={call:async()=>({snapshot:{agents:[],panes,focused_tab_id:'tab'}})},host=new CollectorHost(collector as any,store,rpc as any),params={session:'session',processTarget:{key:'key',owner:'session'}};
 await assert.rejects(host.request('process-output',{...params,terminalId:'view-a'}));
 for(const [terminalId,subtree]of [['view-a',false],['view-b',true]] as const)await host.request('view.poll',{terminalId,key:'session',visible:true,subtree,expanded:true});
 await host.request('process-output',{...params,terminalId:'view-a'});await host.request('process-output',{...params,terminalId:'view-b'});assert.deepEqual(scopes,[false,true]);
 await assert.rejects(host.request('process-output',{...params,session:'other',terminalId:'view-a'}));await assert.rejects(host.request('process-output',{...params,terminalId:'foreign'}));panes=[];await assert.rejects(host.request('process-output',{...params,terminalId:'view-a'}));assert.equal(scopes.length,2);
});
test('non-ASCII terminal output keeps its UTF-8 byte cap without broken characters',async t=>{
 const f=await fixture(t);f.setText('😀'.repeat(20000)+'x');const out=await f.collector.processOutput('codex:s',f.target,async()=>{});
 assert.equal(out?.truncated,true);assert.ok(Buffer.byteLength(out!.text!)<=65536);assert.doesNotMatch(out!.text!,/�/);assert.match(out!.text!,/x$/);
});
