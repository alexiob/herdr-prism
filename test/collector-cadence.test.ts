import {freshPrivateDirectory} from './helpers/private-dir.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Collector} from '../src/runtime/collector.ts';
import {GitCache} from '../src/git/cache.ts';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
test('selected idle resources wait five seconds despite a working background agent; expanded Processes and working selection use faster cadence',async t=>{
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-cadence-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const agents=['a','background'].map((id,i)=>({pane_id:id,terminal_id:id,workspace_id:'w',tab_id:'tab',agent:'codex',agent_status:i?'working':'idle',agent_session:{kind:'id',value:id},focused:!i,revision:1}));
 const records=agents.map(a=>({id:a.pane_id,provider:'codex',messages:[],tools:[],usage:[],goals:[],availability:'known'}));
 const rpc={async call(method:string,payload:any){if(method==='session.snapshot')return {snapshot:{protocol:22,agents}};const i=agents.findIndex(a=>a.pane_id===(payload?.target??payload?.pane_id));if(method==='agent.get')return {agent:agents[i]};if(method==='pane.process_info')return {process_info:{foreground_processes:[{pid:42+i,name:'codex'}]}};return {};}};
 const index={setActiveRefs(){},setDetailedRefs(){},async refreshSnapshots(){return records;},resolveSnapshotCached(_provider:string,ref:any){return records.find(r=>r.id===ref.value);},diagnostics:[],close(){}};
 const sampler={async sample(){const now=Date.now();return {platform:'linux',bootId:'boot',sampledAt:now,monotonicNs:String(BigInt(now)*1000000n),processes:[42,43].map(pid=>({pid,ppid:1,startTime:'1',cpuNs:String(BigInt(now)*1000000n),rssBytes:'100',name:'codex'}))};},async close(){}};
 const collector=new Collector({rpc:rpc as any,index:index as any,sampler,git:{close(){}} as any,stateDir:directory,paneOpen:true,visibleSession:'codex:a',settings:{nativeMode:'inspector-only',providerHomes:{},todosEnabled:false,sampleIntervalMs:2000,follow:false,ascii:true,monochrome:true} as any});
 await collector.init();t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:100000});
 try {
  await collector.start();const selected=()=>collector.data.sessions.find(s=>s.key==='codex:a')!.resource!;
  assert.equal(selected().sampledAt,100000);assert.equal(selected().cpuPercent,undefined);
  t.mock.timers.tick(4999);await settle();assert.equal(selected().sampledAt,100000,'working background must not cause selected-idle host scans');
  t.mock.timers.tick(1);await settle();assert.equal(selected().sampledAt,105000);assert.equal(selected().cpuPercent,100);
  collector.setProcessesExpanded(true);t.mock.timers.tick(999);await settle();assert.equal(selected().sampledAt,105000);
  t.mock.timers.tick(1);await settle();assert.equal(selected().sampledAt,106000);
  collector.setProcessesExpanded(false);agents[0]!.agent_status='working';await collector.refresh();
  t.mock.timers.tick(1999);await settle();assert.equal(selected().sampledAt,106000);
  t.mock.timers.tick(1);await settle();assert.equal(selected().sampledAt,108000);
  collector.setVisibleSession('codex:a',false);await collector.refresh();t.mock.timers.tick(10000);await settle();assert.equal(selected().sampledAt,108000);assert.equal(selected().availability,'stale');
  collector.setVisibleSession('codex:a',true);await collector.refresh();t.mock.timers.tick(1);await settle();assert.equal(selected().cpuPercent,undefined,'resuming must use a fresh baseline');
  t.mock.timers.tick(2000);await settle();assert.equal(selected().cpuPercent,100);
 }finally{await collector.close({clearNative:false});t.mock.timers.reset();}
});
test('selected idle Git retains its measured checkout for thirty seconds despite working background sessions',async t=>{
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-idle-git-'));t.after(()=>rm(directory,{recursive:true,force:true}));const exec=promisify(execFile);const git=async(cwd:string,args:string[])=>(await exec('git',args,{cwd,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}})).stdout;await git(directory,['init','--quiet']);
 const agents=['a','background'].map((id,i)=>({pane_id:id,terminal_id:id,workspace_id:'w',tab_id:'tab',agent:'codex',agent_status:i?'working':'idle',agent_session:{kind:'id',value:id},focused:!i,revision:1}));const evidence=agents.map(a=>({id:a.pane_id,provider:'codex',cwd:directory,messages:[],tools:[],usage:[],goals:[],availability:'known'}));
 const rpc={async call(method:string){return method==='session.snapshot'?{snapshot:{protocol:22,agents}}:{};}};const index={setActiveRefs(){},setDetailedRefs(){},async refreshSnapshots(){return evidence;},resolveSnapshotCached(_provider:string,ref:any){return evidence.find(e=>e.id===ref.value);},diagnostics:[],close(){}};
 let now=1000;const cache=new GitCache({now:()=>now,runner:async(c,args)=>git(c,args)});const collector=new Collector({rpc:rpc as any,index:index as any,git:cache,stateDir:join(directory,'state'),paneOpen:true,visibleSession:'codex:a',settings:{nativeMode:'inspector-only',providerHomes:{},todosEnabled:false,sampleIntervalMs:2000,follow:false,ascii:true,monochrome:true} as any});
 try{await collector.init();await collector.refresh();const selected=()=>collector.data.sessions.find(s=>s.key==='codex:a')!;const initial=selected().git!.untrackedFiles;await writeFile(join(directory,'new-file'),'fixture');now=7000;await collector.refresh();assert.equal(selected().git!.untrackedFiles,initial,'idle selection should retain its measured checkout instead of spawning five-second Git work');agents[0]!.agent_status='working';await collector.refresh();assert.equal(selected().git!.untrackedFiles,initial!+1);}finally{await collector.close({clearNative:false});}
});
