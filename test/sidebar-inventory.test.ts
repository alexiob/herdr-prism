import {test} from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {rm} from 'node:fs/promises';
import {freshPrivateDirectory} from './helpers/private-dir.ts';
import {Collector} from '../src/runtime/collector.ts';
test('closed inspector cold-start publishes checkout and host inventory without detailed work',async t=>{
 const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'prism-sidebar-inventory-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let now=10000,counter=0,heavy=0,body=0,gitHeavy=0;let pid=42;
 const agent:any={pane_id:'p',terminal_id:'t',workspace_id:'w',tab_id:'tab',agent:'claude',agent_status:'idle',cwd:'/project',foreground_cwd:'/project/tree',agent_session:{kind:'id',value:'s'},focused:true,revision:1};
 const writes:any[]=[];const requested:number[][]=[];const paths:string[]=[];
 const rpc:any={call:async(method:string,params:any)=>{
  if(method==='session.snapshot')return {snapshot:{protocol:22,agents:[agent],tabs:[],panes:[]}};
  if(method==='agent.get')return {agent};
  if(method==='pane.get')return {pane:agent};
  if(method==='pane.process_info')return {process_info:{foreground_process_group_id:pid,foreground_processes:[{pid,name:'claude'}]}};
  if(method==='pane.report_metadata')writes.push(params.tokens);
  return {};
 }};
 const identity:any={identityOnly:true,availability:'known',branch:'topic',branchState:'named',checkoutKey:'tree',root:'/project/tree',commonDir:'/project/.git',sampledAt:now,ageMs:0,cwd:'/project/tree'};
 const git:any={getIdentity:async(cwd:string)=>{paths.push(cwd);return identity;},get:async()=>{gitHeavy++;throw Error('hidden Git status');},close(){}};
 const index:any={setActiveRefs(){},setDetailedRefs(){},resolveSnapshotCached(){},refreshSnapshots:async()=>{body++;return [];},diagnostics:[],close(){}};
 const hostSampler:any={sample:async()=>{heavy++;return {platform:'darwin',bootId:'sidebar',monotonicNs:String(BigInt(++counter)*5000000000n),sampledAt:now,processes:[pid].map(pid=>({pid,startTime:'1',cpuNs:String(BigInt(counter)*250000000n),rssBytes:'320000000',name:'claude'}))};},close:async()=>{}};
 const collector=new Collector({rpc,index,git,sidebarSampler:{sample:async(pids:number[])=>{requested.push(pids);throw Error('duplicate PID sampling');},close:async()=>{}},sampler:hostSampler,settings:{nativeMode:'overview',providerHomes:{},todosEnabled:true,sampleIntervalMs:2000,follow:true,ascii:false,monochrome:true},stateDir:dir} as any);
 t.after(()=>collector.close({clearNative:false}));t.mock.method(Date,'now',()=>now);await collector.init();await collector.refresh();
 assert.equal(writes.at(-1).hat_branch,'topic');assert.match(writes.at(-1).hat_load,/RSS 320MB/);assert.equal(writes.at(-1).hat_add,'');assert.equal(collector.data.sessions[0].resource,undefined,'root-only sample must not authorize inspector detail');
 now+=5000;await collector.refresh();assert.match(writes.at(-1).hat_load,/CPU 5%/);assert.deepEqual(requested,[]);assert.equal(heavy,2);assert.ok(paths.every(p=>p==='/project/tree'));assert.equal(body+gitHeavy,0);
 now+=5000;pid=43;await collector.refresh();assert.match(writes.at(-1).hat_load,/CPU —%/,'replacement PID starts a new CPU baseline');
});

import {SidebarInventory} from '../src/runtime/sidebar.ts';
test('native inventory rejects replaced occupants/root PIDs during an in-flight query',async()=>{
 let current:any={pane_id:'p',terminal_id:'t',agent:'claude',agent_session:{kind:'id',value:'s'}};let pid=42;let release!:()=>void,entered!:()=>void;
 const started=new Promise<void>(r=>entered=r),blocked=new Promise<void>(r=>release=r);
 const rpc:any={call:async(method:string)=>method==='agent.get'?{agent:current}:{process_info:{foreground_processes:[{pid,name:'claude'}]}}};
 const sampler:any={sample:async()=>{entered();await blocked;return {platform:'linux',bootId:'b',sampledAt:10000,monotonicNs:'100',processes:[{pid:42,startTime:'1',cpuNs:'100',rssBytes:'100',name:'claude'}]};},close:async()=>{}};
 const inventory=new SidebarInventory(rpc,{close(){}} as any,(_p,p)=>p.name==='claude',sampler);const original=structuredClone(current);const pending=inventory.update([original],10000);await started;current={...current,agent_session:{kind:'id',value:'replacement'}};pid=43;release();await pending;assert.equal(inventory.resource(original,10000),undefined);assert.equal(inventory.resource(current,10000),undefined);await inventory.close();
});
test('identity refresh discards cached change counts when HEAD or checkout differs',async()=>{
 const agent:any={pane_id:'p',terminal_id:'t',agent:'unknown',cwd:'/tree'};
 let head='a';const identity:any={availability:'known',identityOnly:true,branch:'topic',branchState:'named',checkoutKey:'tree',sampledAt:1,ageMs:0,cwd:'/tree'};
 const inventory=new SidebarInventory({call:async()=>({})} as any,{getIdentity:async()=>({...identity,head})} as any,()=>false,{sample:async()=>({platform:'linux',bootId:'b',sampledAt:1,monotonicNs:'1',processes:[]}),close:async()=>{}});
 await inventory.update([agent],10000);const detail={...identity,identityOnly:false,head:'a',added:12,deleted:3};assert.equal(inventory.gitIdentity(agent,detail)!.added,12);head='b';await inventory.update([agent],11000);assert.equal(inventory.gitIdentity(agent,detail)!.added,undefined);assert.equal(inventory.gitIdentity(agent,detail)!.head,'b');await inventory.close();
});
test('unsupported resource mode retains checkout discovery with no PID or sampler work',async()=>{
 let roots=0,samples=0,identities=0;const agent:any={pane_id:'p',terminal_id:'t',agent:'codex',cwd:'/project'};
 const inventory=new SidebarInventory({call:async()=>{roots++;return{};}} as any,{getIdentity:async()=>{identities++;return {branch:'main'};}} as any,()=>true,{sample:async()=>{samples++;throw Error('unsupported');},close:async()=>{}},false);
 await inventory.update([agent],10000);await inventory.update([agent],16000);assert.equal(identities,2);assert.equal(roots+samples,0);assert.equal(inventory.gitIdentity(agent)!.branch,'main');await inventory.close();
});
test('closing during a sample prevents later root queries and publication',async()=>{
 const agent:any={pane_id:'p',terminal_id:'t',agent:'claude'};let gets=0,release!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r),blocked=new Promise<void>(r=>release=r);
 const inventory=new SidebarInventory({call:async(method:string)=>{if(method==='agent.get'){gets++;return{agent};}return{process_info:{foreground_processes:[{pid:42,name:'claude'}]}};}} as any,{} as any,()=>true,{sample:async()=>{entered();await blocked;return{platform:'linux',bootId:'b',sampledAt:1,monotonicNs:'1',processes:[]};},close:async()=>{}});
 const pending=inventory.update([agent],10000);await started;await inventory.close();release();await pending;assert.equal(gets,1);assert.equal(inventory.resource(agent),undefined);
});

test('native cards aggregate verified harness jobs from one host batch while closed, leaving inspector details gated',async t=>{
 const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'prism-native-jobs-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let now=10000,samples=0,body=0,gitHeavy=0,pidOnly=0,newborn=false;const writes=new Map<string,any>();
 const agents=['a','b'].map((id,i)=>({pane_id:id,terminal_id:'t-'+id,workspace_id:'w',tab_id:'tab',agent:'codex',agent_status:'working',agent_session:{kind:'id',value:id},revision:1}));
 const rpc:any={call:async(method:string,p:any)=>{if(method==='session.snapshot')return {snapshot:{protocol:22,agents}};const i=agents.findIndex(a=>a.pane_id===(p?.target??p?.pane_id));if(method==='agent.get')return{agent:agents[i]};if(method==='pane.get')return{pane:agents[i]};if(method==='pane.process_info')return{process_info:{foreground_process_group_id:42+i,foreground_processes:[{pid:42+i,name:'codex'}]}};if(method==='pane.report_metadata')writes.set(p.pane_id,p.tokens);return{};}};
 const sampler:any={sample:async()=>{samples++;return{platform:'linux',bootId:'boot',sampledAt:now,monotonicNs:String(BigInt(now)*1000000n),processes:[{pid:42,ppid:1,startTime:'1',cpuNs:String(BigInt(now)*50000n),rssBytes:'100000000',name:'codex'},{pid:44,ppid:42,startTime:'2',cpuNs:String(BigInt(now)*1000000n),rssBytes:'500000000',name:'rustc'},{pid:43,ppid:1,startTime:'1',cpuNs:String(BigInt(now)*200000n),rssBytes:'200000000',name:'codex'},{pid:45,ppid:1,startTime:'2',cpuNs:String(BigInt(now)*3000000n),rssBytes:'900000000',name:'unrelated'},...newborn?[{pid:46,ppid:42,startTime:'3',cpuNs:'999000000000',rssBytes:'100000000',name:'cargo'}]:[]]};},close:async()=>{}};
 const index:any={setActiveRefs(){},setDetailedRefs(){},resolveSnapshotCached(){},refreshSnapshots:async()=>{body++;return[];},readTodoState:async()=>undefined,diagnostics:[],close(){}};
 const collector=new Collector({rpc,index,sampler,sidebarSampler:{sample:async()=>{pidOnly++;throw Error('duplicate sampler');},close:async()=>{}},git:{get:async()=>{gitHeavy++;throw Error('hidden status');},close(){}} as any,settings:{nativeMode:'overview',providerHomes:{},todosEnabled:true,sampleIntervalMs:2000,follow:true,ascii:false,monochrome:true},stateDir:dir});t.after(()=>collector.close({clearNative:false}));t.mock.method(Date,'now',()=>now);await collector.init();await collector.refresh();
 assert.match(writes.get('a').hat_load,/RSS 600MB/);assert.match(writes.get('a').hat_load,/CPU —%/);assert.equal(collector.data.sessions[0].resource,undefined);
 now+=4999;await collector.refresh();assert.equal(samples,1);now++;await collector.refresh();
 assert.equal(samples,2);assert.match(writes.get('a').hat_load,/CPU 105%.*RSS 600MB/);assert.match(writes.get('b').hat_load,/CPU 20%.*RSS 200MB/);assert.doesNotMatch(writes.get('a').hat_load,/H CPU/);assert.equal(body+gitHeavy+pidOnly,0);
 collector.setVisibleSession('codex:a',true);await collector.refresh();await collector.sampleProcesses();now+=2000;await collector.sampleProcesses();await collector.refresh();assert.equal(collector.dataForView('codex:a').sessions.find(s=>s.key==='codex:a')!.resource!.memoryBytes,'600000000');assert.match(writes.get('a').hat_load,/CPU 105%.*RSS 600MB/,'native CPU must survive inspector baseline resets');
 newborn=true;now+=2000;await collector.sampleProcesses();await collector.refresh();const partial=collector.dataForView('codex:a').sessions.find(s=>s.key==='codex:a')!;assert.equal(partial.resource!.cpuPercent,undefined);assert.equal(partial.resource!.cpuLowerBound,105);assert.equal(partial.history!.points!.at(-1)!.cpuLowerBound,105);assert.equal(partial.history!.points!.at(-1)!.cpuPercent,undefined);assert.match(writes.get('a').hat_load,/CPU ≥105%.*RSS 700MB/);
});
test('native proof refresh finds a changed foreground harness within five seconds without querying every host sample',async t=>{
 const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'prism-native-proof-'));t.after(()=>rm(dir,{recursive:true,force:true}));let now=10000,foreground=42,queries=0,tokens:any;
 const agent:any={pane_id:'a',terminal_id:'t',workspace_id:'w',tab_id:'tab',agent:'codex',agent_status:'working',agent_session:{kind:'id',value:'a'}};
 const rpc:any={call:async(method:string,p:any)=>{if(method==='session.snapshot')return{snapshot:{protocol:22,agents:[agent]}};if(method==='agent.get')return{agent};if(method==='pane.get')return{pane:agent};if(method==='pane.process_info'){queries++;return{process_info:{foreground_process_group_id:foreground,foreground_processes:[{pid:foreground,name:'codex'}]}};}if(method==='pane.report_metadata')tokens=p.tokens;return{};}};
 const index:any={setActiveRefs(){},setDetailedRefs(){},resolveSnapshotCached(){},diagnostics:[],close(){}};
 const collector=new Collector({rpc,index,sampler:{sample:async()=>({platform:'linux',bootId:'boot',sampledAt:now,monotonicNs:String(BigInt(now)*1000000n),processes:[{pid:42,ppid:1,startTime:'1',cpuNs:String(BigInt(now)*100000n),rssBytes:'100',name:'codex'},{pid:43,ppid:1,startTime:'2',cpuNs:String(BigInt(now)*100000n),rssBytes:'200',name:'codex'},{pid:44,ppid:43,startTime:'3',cpuNs:String(BigInt(now)*100000n),rssBytes:'300',name:'rustc'}]}),close:async()=>{}},git:{close(){}} as any,settings:{nativeMode:'overview',providerHomes:{},todosEnabled:false,sampleIntervalMs:1000,follow:false,ascii:false,monochrome:true},stateDir:dir});t.after(()=>collector.close({clearNative:false}));t.mock.method(Date,'now',()=>now);await collector.init();await collector.refresh();assert.equal(queries,1);assert.match(tokens.hat_load,/RSS 100B/);
 foreground=43;for(let i=0;i<4;i++){now+=1000;await collector.sampleProcesses();await collector.refresh();}assert.equal(queries,1,'unselected roots must reuse identity proof within its bounded cache');
 now+=1000;await collector.sampleProcesses();await collector.refresh();assert.equal(queries,2);assert.match(tokens.hat_load,/RSS 600B/,'new foreground jobs join remembered exact old process identities');
});
test('closing inspector during a failed native batch keeps native metrics stale without appending hidden history',async t=>{
 const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'prism-native-failure-'));t.after(()=>rm(dir,{recursive:true,force:true}));let now=10000,fail=false,tokens:any,release!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r),blocked=new Promise<void>(r=>release=r);
 const agent:any={pane_id:'a',terminal_id:'t',workspace_id:'w',tab_id:'tab',agent:'codex',agent_status:'working',agent_session:{kind:'id',value:'a'}};
 const rpc:any={call:async(method:string,p:any)=>{if(method==='session.snapshot')return{snapshot:{protocol:22,agents:[agent]}};if(method==='agent.get')return{agent};if(method==='pane.get')return{pane:agent};if(method==='pane.process_info')return{process_info:{foreground_processes:[{pid:42,name:'codex'}]}};if(method==='pane.report_metadata')tokens=p.tokens;return{};}};
 const index:any={setActiveRefs(){},setDetailedRefs(){},resolveSnapshotCached(){},refreshSnapshots:async()=>[],diagnostics:[],close(){}};
 const collector=new Collector({rpc,index,sampler:{sample:async()=>{if(fail){entered();await blocked;throw Error('native timeout');}return{platform:'linux',bootId:'boot',sampledAt:now,monotonicNs:String(BigInt(now)*1000000n),processes:[{pid:42,ppid:1,startTime:'1',cpuNs:String(BigInt(now)*100000n),rssBytes:'100',name:'codex'}]};},close:async()=>{}},git:{close(){}} as any,settings:{nativeMode:'overview',providerHomes:{},todosEnabled:false,sampleIntervalMs:1000,follow:false,ascii:false,monochrome:true},stateDir:dir});t.after(()=>collector.close({clearNative:false}));t.mock.method(Date,'now',()=>now);await collector.init();await collector.refresh();collector.setVisibleSession('codex:a',true);await collector.refresh();await collector.sampleProcesses();const before=collector.history.view('codex:a','self',now).points.length;
 now+=1000;fail=true;const pending=collector.sampleProcesses();await started;collector.setVisibleSession('codex:a',false);release();await pending;assert.equal(collector.history.view('codex:a','self',now).points.length,before,'closed generation must not collect late failure gaps');await collector.refresh();assert.match(tokens.hat_load,/^~ CPU/);assert.equal(tokens.hat_fresh,'cached');
});
test('collector shutdown during a native batch prevents late native metadata publication',async t=>{
 const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'prism-native-stop-'));t.after(()=>rm(dir,{recursive:true,force:true}));let release!:()=>void,entered!:()=>void,writes=0;const started=new Promise<void>(r=>entered=r),blocked=new Promise<void>(r=>release=r);
 const agent:any={pane_id:'a',terminal_id:'t',workspace_id:'w',tab_id:'tab',agent:'codex',agent_status:'working',agent_session:{kind:'id',value:'a'}};
 const rpc:any={call:async(method:string)=>{if(method==='session.snapshot')return{snapshot:{protocol:22,agents:[agent]}};if(method==='agent.get')return{agent};if(method==='pane.get')return{pane:agent};if(method==='pane.process_info')return{process_info:{foreground_processes:[{pid:42,name:'codex'}]}};if(method==='pane.report_metadata')writes++;return{};}};
 const collector=new Collector({rpc,index:{setActiveRefs(){},setDetailedRefs(){},resolveSnapshotCached(){},diagnostics:[],close(){}} as any,sampler:{sample:async()=>{entered();await blocked;return{platform:'linux',bootId:'boot',sampledAt:Date.now(),monotonicNs:'1000000000',processes:[{pid:42,ppid:1,startTime:'1',cpuNs:'100',rssBytes:'100',name:'codex'}]};},close:async()=>{}},git:{close(){}} as any,settings:{nativeMode:'overview',providerHomes:{},todosEnabled:false,sampleIntervalMs:1000,follow:false,ascii:false,monochrome:true},stateDir:dir});
 await collector.init();const refresh=collector.refresh();await started;const closing=collector.close({clearNative:false});release();await refresh;await closing;assert.equal(writes,0,'a stopped collector cannot publish metadata after a delayed native sample');
});
