// Synthetic collector-host benchmark; it never connects to Herdr or reads provider homes.
import {mkdtemp,rm,realpath} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {performance} from 'node:perf_hooks';
const args=process.argv.slice(2),source=args.includes('--source'),rootIndex=args.indexOf('--runtime-root');
if(rootIndex>=0&&(!args[rootIndex+1]||args[rootIndex+1].startsWith('--')))throw Error('--runtime-root requires a path');
const root=resolve(rootIndex>=0?args[rootIndex+1]:'.');
const module=file=>import(pathToFileURL(join(root,source?'src':'dist',file+(source?'.ts':'.js'))).href);
const [{Collector},{CollectorHost},{StateStore}]=await Promise.all([module('runtime/collector'),module('runtime/collector-service'),module('state/store')]);
const output={runtimeRoot:root,source,node:process.version,platform:process.platform,synthetic:true,fixture:{sessions:30,messagesPerSession:40,messageCharacters:256,usageRecordsPerSession:80},cases:[]};
for(const mode of ['unchanged','changing-one-hz'])for(const count of [1,7,20]){
 const dir=await realpath(await mkdtemp(join(tmpdir(),'prism-projection-bench-')));try{
  const settings={nativeMode:'inspector-only',providerHomes:{},todosEnabled:false,sampleIntervalMs:2000,follow:false,ascii:true,monochrome:true};
  const sessions=Array.from({length:30},(_,i)=>({key:'pi:s'+i,children:[],evidence:{id:'s'+i,provider:'pi',availability:'known',messages:Array.from({length:40},(_,j)=>({id:'m'+j,role:'assistant',text:'x'.repeat(256)})),tools:[],goals:[],usage:Array.from({length:80},(_,j)=>({id:'u'+j,kind:'delta',input:100,output:50,total:150,timestamp:j,includesChildren:false}))},refs:[],todos:[]}));
  const records=Array.from({length:count},(_,i)=>({tabId:'tab',paneId:'panel'+i,terminalId:'view'+i,targetTerminalId:'native'+i,open:true,ready:true,pid:process.pid}));
  const agents=Array.from({length:30},(_,i)=>({pane_id:'agent'+i,terminal_id:'native'+i,tab_id:'tab',workspace_id:'w',agent:'pi',agent_session:{kind:'id',value:'s'+i}}));const snapshot={protocol:22,agents,panes:[...agents,...records.map(r=>({pane_id:r.paneId,terminal_id:r.terminalId,tab_id:'tab',workspace_id:'w'}))],layouts:[],focused_pane_id:'agent0',focused_tab_id:'tab',focused_workspace_id:'w'};
  let rpcCalls=0;const rpc={call:async method=>{if(method!=='session.snapshot')throw Error('Unexpected benchmark RPC');rpcCalls++;return{snapshot};}};
  const c=new Collector({rpc,settings,stateDir:dir,index:{setDetailedRefs(){},close(){}},sampler:{sample:async()=>{throw Error('Unused sampler');},close:async()=>{}},git:{close(){}}});c.data={sessions,updatedAt:1,stale:false,diagnostics:[]};const store=new StateStore(dir);await store.write('views',records);const host=new CollectorHost(c,store,rpc),revisions=new Map(),snapshots=new Map();let bytes=0,fullResponses=0;
  const poll=async(i,visible=true)=>{const value=await host.request('view.poll',{terminalId:'view'+i,key:'pi:s'+i,visible,subtree:false,expanded:false,revision:revisions.get(i),snapshotRevision:snapshots.get(i)});revisions.set(i,value.revision);snapshots.set(i,value.snapshotRevision);if(value.data)fullResponses++;bytes+=Buffer.byteLength(JSON.stringify(value));};
  for(let round=0;round<2;round++)for(let i=0;i<count;i++)await poll(i);rpcCalls=0;bytes=0;fullResponses=0;const realNow=Date.now;let clock=realNow();Date.now=()=>clock;const start=performance.now();try{for(let n=0;n<10;n++){clock+=500;if(mode==='changing-one-hz'&&n%2===0){c.data.updatedAt=clock;c.emit('data',c.data);}for(let i=0;i<count;i++)await poll(i);}}finally{Date.now=realNow;}const elapsedMs=performance.now()-start;
  output.cases.push({mode,views:count,polls:count*10,nativeSnapshotRpcCalls:rpcCalls,fullResponses,responseBytes:bytes,elapsedMs:Number(elapsedMs.toFixed(2)),msPerPoll:Number((elapsedMs/count/10).toFixed(3))});
 }finally{await rm(dir,{recursive:true,force:true});}
}
process.stdout.write(JSON.stringify(output,null,2)+'\n');
