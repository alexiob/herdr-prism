import {test} from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {rm} from 'node:fs/promises';
import {freshPrivateDirectory} from './helpers/private-dir.ts';
import {Collector} from '../src/runtime/collector.ts';
test('closed inspector cold-start publishes checkout and PID-only resources without detailed work',async t=>{
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
 const sidebarSampler:any={sample:async(pids:number[])=>{requested.push(pids);return {platform:'darwin',bootId:'sidebar',monotonicNs:String(BigInt(++counter)*5000000000n),sampledAt:now,processes:pids.map(pid=>({pid,startTime:'1',cpuNs:String(BigInt(counter)*250000000n),rssBytes:'320000000',name:'claude'}))};},close:async()=>{}};
 const collector=new Collector({rpc,index,git,sidebarSampler,sampler:{sample:async()=>{heavy++;throw Error('hidden process scan');},close:async()=>{}},settings:{nativeMode:'overview',providerHomes:{},todosEnabled:true,sampleIntervalMs:2000,follow:true,ascii:false,monochrome:true},stateDir:dir} as any);
 t.after(()=>collector.close({clearNative:false}));t.mock.method(Date,'now',()=>now);await collector.init();await collector.refresh();
 assert.equal(writes.at(-1).hat_branch,'topic');assert.match(writes.at(-1).hat_load,/RSS 320MB/);assert.equal(writes.at(-1).hat_add,'');assert.equal(collector.data.sessions[0].resource,undefined,'root-only sample must not authorize inspector detail');
 now+=5000;await collector.refresh();assert.match(writes.at(-1).hat_load,/CPU 5%/);assert.deepEqual(requested,[[42],[42]]);assert.ok(paths.every(p=>p==='/project/tree'));assert.equal(heavy+body+gitHeavy,0);
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
