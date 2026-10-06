import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {Collector} from '../src/runtime/collector.ts';import {ProviderIndex} from '../src/providers/index.ts';import {JsonlTail} from '../src/providers/tail.ts';
test('closing the pane cancels an in-progress real transcript read before the next record',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'prism-read-cancel-'));t.after(()=>rm(dir,{recursive:true,force:true}));const home=path.join(dir,'codex');await mkdir(path.join(home,'sessions'),{recursive:true});
 await writeFile(path.join(home,'sessions','r.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'r',cwd:dir}})+'\n'+Array.from({length:1000},(_,i)=>JSON.stringify({type:'response_item',payload:{type:'message',id:String(i),role:'assistant',content:[{type:'output_text',text:'Message '+i}]}})+'\n').join(''));
 const agent:any={pane_id:'p',terminal_id:'t',workspace_id:'w',tab_id:'tab',agent:'codex',agent_status:'working',agent_session:{source:'herdr:codex',kind:'id',value:'r'},cwd:dir,focused:true};
 const index=new ProviderIndex({codexHome:home,claudeHome:path.join(dir,'claude'),piHome:path.join(dir,'pi')});
 let collector:Collector,consumed=0,gitReads=0;const original=JsonlTail.prototype.read;
 (JsonlTail.prototype as any).read=function(...args:any[]){const consume=args[1];args[1]=(entry:any)=>{consume(entry);if(entry.record.type==='response_item'){consumed++;if(consumed===1)collector.setVisibleSession('codex:r',false);}};return original.apply(this,args as any);};t.after(()=>{JsonlTail.prototype.read=original;});
 collector=new Collector({rpc:{call:async()=>({snapshot:{protocol:22,agents:[agent],panes:[],tabs:[],workspaces:[],layouts:[]}})} as any,index,paneOpen:true,visibleSession:'codex:r',settings:{nativeMode:'inspector-only',providerHomes:{},todosEnabled:true,sampleIntervalMs:2000,follow:true,ascii:false,monochrome:true},stateDir:path.join(dir,'state'),git:{get:async()=>{gitReads++;return{availability:'unavailable'}},close(){}} as any});t.after(()=>collector.close());
 await collector.init();await collector.refresh();assert.equal(consumed,1);assert.equal(gitReads,0);
 collector.setVisibleSession('codex:r',true);await collector.refresh();assert.notEqual(collector.data.sessions.find(s=>s.key==='codex:r')!.evidence.availability,'stale','a resumed complete read must clear the paused marker');
});
test('parsed model, messages and usage are published before reference history finishes',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'prism-body-progress-'));t.after(()=>rm(dir,{recursive:true,force:true}));let enter!:()=>void,finish!:()=>void;
 const entered=new Promise<void>(r=>enter=r),blocked=new Promise<void>(r=>finish=r);
 const agent:any={pane_id:'p',terminal_id:'t',workspace_id:'w',tab_id:'tab',agent:'codex',agent_status:'working',agent_session:{kind:'id',value:'r'},focused:true};
 const evidence:any={id:'r',provider:'codex',model:'fixture-model',messages:[{id:'m',role:'assistant',text:'Recorded message'}],tools:[],goals:[],usage:[{id:'u',kind:'cumulative',sessionId:'r',input:120,output:5}],availability:'known'};
 const index:any={setActiveRefs(){},setDetailedRefs(){},refreshSnapshots:async()=>[evidence],resolveSnapshotCached:()=>evidence,readReferences:async()=>{enter();await blocked;return{refs:[],limited:false,observedAt:Date.now()}},diagnostics:[],close(){}};
 const collector=new Collector({rpc:{call:async()=>({snapshot:{protocol:22,agents:[agent],panes:[],tabs:[],workspaces:[],layouts:[]}})} as any,index,paneOpen:true,visibleSession:'codex:r',settings:{nativeMode:'inspector-only',providerHomes:{},todosEnabled:false,sampleIntervalMs:2000,follow:true,ascii:false,monochrome:true},stateDir:dir});t.after(()=>collector.close());
 await collector.init();const refresh=collector.refresh();await entered;
 assert.equal(collector.data.sessions[0].evidence.model,'fixture-model');assert.equal(collector.data.sessions[0].evidence.messages.length,1);assert.equal(collector.data.sessions[0].usage?.input,120);assert.equal(collector.data.sessions[0].refCoverage,'unavailable');finish();await refresh;assert.equal(collector.data.sessions[0].refCoverage,'session');
 const observed=collector.data.sessions[0].refUpdatedAt;await collector.refresh();assert.equal(collector.data.sessions[0].refUpdatedAt,observed,'interim frames must preserve ref freshness after unchanged refresh');
});
test('a cancelled ACTION hydration does not mark a reopened session as hydrated',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'prism-action-reopen-'));t.after(()=>rm(dir,{recursive:true,force:true}));let enter!:()=>void,finish!:()=>void,calls=0;
 const entered=new Promise<void>(r=>enter=r),blocked=new Promise<void>(r=>finish=r);
 const agent:any={pane_id:'p',terminal_id:'t',workspace_id:'w',tab_id:'tab',agent:'codex',agent_status:'working',agent_session:{kind:'id',value:'r'},focused:true};
 const evidence:any={id:'r',provider:'codex',messages:[],tools:[],goals:[],usage:[],availability:'known'};
 const index:any={setActiveRefs(){},setDetailedRefs(){},refreshSnapshots:async()=>[evidence],resolveSnapshotCached:()=>evidence,readTodoState:async()=>{if(++calls===1){enter();await blocked;}return undefined},diagnostics:[],close(){}};
 const collector=new Collector({rpc:{call:async()=>({snapshot:{protocol:22,agents:[agent],panes:[],tabs:[],workspaces:[],layouts:[]}})} as any,index,paneOpen:true,visibleSession:'codex:r',settings:{nativeMode:'inspector-only',providerHomes:{},todosEnabled:true,sampleIntervalMs:2000,follow:true,ascii:false,monochrome:true},stateDir:dir});t.after(()=>collector.close());
 await collector.init();const refresh=collector.refresh();await entered;collector.setVisibleSession('codex:r',false);collector.setVisibleSession('codex:r',true);finish();await refresh;await collector.refresh();assert.equal(calls,2);
});
test('cancelled JSONL readers resume without duplicate records or a false rotation',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'prism-tail-resume-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'data.jsonl');await writeFile(file,Array.from({length:5},(_,id)=>JSON.stringify({id})+'\n').join(''));
 const tail=new JsonlTail(1024),seen:number[]=[];let current=true,resets=0;
 await assert.rejects(tail.read(file,({record})=>{seen.push(record.id);current=false;},()=>resets++,()=>{},()=>current),{name:'AbortError'});
 current=true;await tail.read(file,({record})=>seen.push(record.id),()=>resets++,()=>{},()=>current);assert.deepEqual(seen,[0,1,2,3,4]);assert.equal(resets,0);
});
