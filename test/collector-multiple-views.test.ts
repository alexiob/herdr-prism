import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {rm} from 'node:fs/promises';
import {freshPrivateDirectory} from './helpers/private-dir.ts';
import {StateStore} from '../src/state/store.ts';
import {Collector} from '../src/runtime/collector.ts';
import {CollectorHost} from '../src/runtime/collector-service.ts';
import {JsonlTail} from '../src/providers/tail.ts';

test('simultaneous same-tab selections hydrate both visible sessions and keep resources, scope and history independent',async t=>{
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-multi-collect-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const ids=['a','child','b','hidden'];
 const agents=ids.map((id,i)=>({pane_id:id,terminal_id:'t-'+id,workspace_id:'w',tab_id:'tab',agent:'codex',agent_status:'working',agent_session:{kind:'id' as const,value:id},focused:i===0,revision:1}));
 const evidence=ids.map(id=>({id,provider:'codex',parentId:id==='child'?'a':undefined,cwd:'/'+id,messages:[],tools:[],goals:[],usage:[{id:'u-'+id,kind:'delta',input:id==='child'?20:10,output:1,includesChildren:false}],availability:'known'}));
 let detailRefs:any[]=[],sampleCount=0,now=Date.now();t.mock.method(Date,'now',()=>now);const gitReads:string[]=[],refReads:string[]=[];
 const index={setActiveRefs(){},setDetailedRefs(values:any[]){detailRefs=values;},refreshSnapshots:async()=>evidence,resolveSnapshotCached:(_provider:string,ref:any)=>evidence.find(e=>e.id===ref.value),readReferences:async(_provider:string,ref:any)=>{refReads.push(ref.value);return{refs:[],limited:false,observedAt:now};},pageReferences:async()=>({refs:[],hasMore:false}),diagnostics:[],close(){}};
 const panes:any[]=[...agents,{pane_id:'panel-a',terminal_id:'view-a',workspace_id:'w',tab_id:'tab'},{pane_id:'panel-b',terminal_id:'view-b',workspace_id:'w',tab_id:'tab'}];
 const rpc={call:async(method:string,p:any={})=>{if(method==='session.snapshot')return{snapshot:{protocol:22,agents,panes,focused_tab_id:'tab',focused_workspace_id:'w'}};const i=agents.findIndex(a=>a.pane_id===(p.target??p.pane_id));if(method==='agent.get')return{agent:agents[i]};if(method==='pane.process_info')return{process_info:{foreground_processes:[{pid:41+i,name:'codex'}]}};return{};}};
 const sampler={sample:async()=>{sampleCount++;return{platform:'fixture',bootId:'boot',sampledAt:now,monotonicNs:String(BigInt(now)*1000000n),processes:ids.map((_id,i)=>({pid:41+i,ppid:i===1?41:1,startTime:String(i),cpuNs:String(BigInt(now)*1000000n),rssBytes:String((i+1)*10),name:'codex'}))};},close:async()=>{}};
 const collector=new Collector({rpc:rpc as any,index:index as any,sampler,git:{get:async(cwd:string)=>{gitReads.push(cwd);return{availability:'known',cwd,sampledAt:now,ageMs:0};},close(){}} as any,stateDir:directory,settings:{nativeMode:'inspector-only',providerHomes:{},todosEnabled:false,sampleIntervalMs:2000,follow:false,ascii:true,monochrome:true}});
 t.after(()=>collector.close({clearNative:false}));await collector.init();await collector.refresh();
 const store=new StateStore(directory);await store.write('views',[{tabId:'tab',paneId:'panel-a',terminalId:'view-a',targetTerminalId:'t-a',open:true},{tabId:'tab',paneId:'panel-b',terminalId:'view-b',targetTerminalId:'t-b',open:true}]);
 const host=new CollectorHost(collector,store,rpc as any),poll=(terminalId:string,key:string,subtree=false,visible=true)=>host.request('view.poll',{terminalId,key,subtree,visible,expanded:false});
 await poll('view-a','codex:a',true);await poll('view-b','codex:b');await collector.refresh();assert.deepEqual(detailRefs.map(r=>r.value).sort(),['a','b']);assert.deepEqual([...new Set(gitReads)].sort(),['/a','/b']);assert.deepEqual([...new Set(refReads)].sort(),['a','b']);
 await collector.sampleProcesses();now+=1000;await collector.sampleProcesses();
 const first=(await poll('view-a','codex:a',true)).data.sessions.find((s:any)=>s.key==='codex:a'),second=(await poll('view-b','codex:b')).data.sessions.find((s:any)=>s.key==='codex:b');
 assert.equal(first.resource.memoryBytes,'30');assert.equal(first.resource.cpuPercent,200);assert.equal(first.usage.input,30);assert.equal(second.resource.memoryBytes,'30');assert.equal(second.resource.cpuPercent,100);assert.equal(second.usage.input,10);assert.equal(first.history.peakMemoryBytes,'30');assert.equal(collector.history.view('codex:a','self').points.length,0,'an undisplayed scope must not collect a parallel history');assert.equal(collector.history.view('codex:child','subtree').points.length,0,'only displayed selections own charts');
 assert.ok(collector.isSessionVisible('codex:a'));assert.ok(collector.isSessionVisible('codex:b'));assert.equal(collector.isSessionVisible('codex:hidden'),false);assert.equal(collector.data.sessions.find(s=>s.key==='codex:hidden')?.resource,undefined);
 // Reader two explicitly inspects the same parent with its own self scope.
 await poll('view-b','codex:a');now+=1000;await collector.sampleProcesses();
 const subtree=(await poll('view-a','codex:a',true)).data.sessions.find((s:any)=>s.key==='codex:a'),self=(await poll('view-b','codex:a')).data.sessions.find((s:any)=>s.key==='codex:a');
 assert.equal(subtree.resource.memoryBytes,'30');assert.equal(self.resource.memoryBytes,'10');assert.equal(subtree.usage.input,30);assert.equal(self.usage.input,10);assert.equal(subtree.history.peakMemoryBytes,'30');assert.equal(self.history.peakMemoryBytes,'10');assert.equal(self.resource.cpuPercent,100,'adding/changing another visible view must preserve the shared CPU baseline');
 const childProcess=subtree.resource.processes.find((p:any)=>p.owner==='codex:child');assert.ok(childProcess);
 const childOutput=await host.request('process-output',{terminalId:'view-a',session:'codex:a',processTarget:{key:childProcess.key,owner:childProcess.owner}});assert.equal(childOutput?.owner,'codex:child');assert.equal(await host.request('process-output',{terminalId:'view-b',session:'codex:a',processTarget:{key:childProcess.key,owner:childProcess.owner}}),undefined,'the second panel self scope cannot borrow the first panel subtree permission');
 // Repeated alternating polls leave the CPU generation and reference cache untouched.
 for(let i=0;i<4;i++){await poll('view-a','codex:a',true);await poll('view-b','codex:a');}assert.equal((await poll('view-b','codex:a')).data.sessions.find((s:any)=>s.key==='codex:a').resource.cpuPercent,100);
 await host.request('view.closed',{terminalId:'view-a'});now+=1000;await collector.sampleProcesses();assert.equal((await poll('view-b','codex:a')).data.sessions.find((s:any)=>s.key==='codex:a').resource.cpuPercent,100,'closing one panel must not warm up a remaining displayed session');assert.ok(await collector.pageReferences('codex:a'));
 await poll('view-b','codex:a',false,false);const count=sampleCount;await collector.sampleProcesses();await collector.refresh();assert.equal(sampleCount,count);assert.equal(await collector.pageReferences('codex:a'),undefined);
});

test('two selected reference histories retain independent incremental readers instead of reparsing on each switch',async t=>{
 const {mkdir,writeFile}=await import('node:fs/promises');const {ProviderIndex}=await import('../src/providers/index.ts');
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-multi-ref-cache-'));t.after(()=>rm(directory,{recursive:true,force:true}));const home=join(directory,'codex');await mkdir(join(home,'sessions'),{recursive:true});
 for(const id of ['a','b']){await writeFile(join(directory,id+'.ts'),'fixture');await writeFile(join(home,'sessions',id+'.jsonl'),[{type:'session_meta',payload:{id,cwd:directory}},{type:'response_item',payload:{type:'message',id:'m-'+id,role:'assistant',content:[{type:'output_text',text:'See `'+id+'.ts`'}]}}].map(row=>JSON.stringify(row)+'\n').join(''));}
 const index=new ProviderIndex({codexHome:home,claudeHome:join(directory,'claude'),piHome:join(directory,'pi')});t.after(()=>index.close());const refs=['a','b'].map(value=>({provider:'codex',kind:'id' as const,value}));index.setActiveRefs(refs);index.setDetailedRefs(refs);await index.refreshSnapshots();
 let consumed=0;const original=JsonlTail.prototype.read;t.mock.method(JsonlTail.prototype,'read',function(this:JsonlTail,...args:Parameters<JsonlTail['read']>){const consume=args[1];args[1]=record=>{consumed++;consume(record);};return original.apply(this,args);});
 for(const ref of refs){const state=await index.readReferences('codex',ref);assert.equal(state?.refs.length,1);assert.equal(state?.refs[0].messageId,'m-'+ref.value);}
 const initial=consumed;assert.ok(initial>0);
 for(let i=0;i<3;i++)for(const ref of refs)assert.equal((await index.readReferences('codex',ref))?.refs[0].messageId,'m-'+ref.value);
 assert.equal(consumed,initial,'alternating panels must not reread unchanged historical JSONL records');
});
