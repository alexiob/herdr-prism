import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {freshPrivateDirectory} from './helpers/private-dir.ts';
import {StateStore} from '../src/state/store.ts';
import * as panels from '../src/runtime/panel-views.ts';

const own={paneId:'inspector',terminalId:'inspector-term',tabId:'tab'};
const record={...own,targetTerminalId:'native-term',open:true};

test('an inspector launched before its open response is published waits for its exact authoritative binding',async t=>{
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-startup-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=new StateStore(directory);let child:Promise<any>|undefined;let completed=false;
 const native={pane_id:'native',terminal_id:'native-term',tab_id:'tab'},pane={pane_id:own.paneId,terminal_id:own.terminalId,tab_id:own.tabId};
 const rpc={call:async(method:string)=>{if(method==='session.snapshot')return{snapshot:{panes:[native,pane],focused_pane_id:'native'}};if(method==='plugin.pane.open'){
  child=panels.waitForPanelRecord(store,own,1000).then(value=>{completed=true;return value;});
  await new Promise(resolve=>setTimeout(resolve,60));assert.equal(await store.read('views'),undefined);assert.equal(completed,false,'the child cannot bind before the authoritative response is published');
  return{plugin_pane:{plugin_id:'iob.herdr-prism',entrypoint:'inspector',pane}};
 }return{};}};
 await new panels.PanelViews(store,rpc as any).open('native');
 assert.deepEqual(await child,{...record,ready:false});
});

test('startup never adopts a neighbor or an old pane with the same tab and fails within its bound',async t=>{
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-startup-mismatch-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=new StateStore(directory);
 await store.write('views',[{...record,paneId:'neighbor',terminalId:'neighbor-term'}]);
 await assert.rejects(panels.waitForPanelRecord(store,own,60),/binding did not become available/);
 await store.write('views',[{...record,paneId:'old-inspector'}]);
 await assert.rejects(panels.waitForPanelRecord(store,own,60),/binding identity changed/);
 await store.write('views',[{...record,targetTerminalId:undefined}]);
 await assert.rejects(panels.waitForPanelRecord(store,own,60),/binding did not become available/);
});

test('a frontend readiness receipt requires exact registration, a live PID and the matching native pane snapshot',async t=>{
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-ready-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=new StateStore(directory);
 await store.write('views',[record]);let pane={pane_id:own.paneId,terminal_id:own.terminalId,tab_id:own.tabId};const views=new panels.PanelViews(store,{call:async()=>({snapshot:{panes:[pane]}})} as any);
 await assert.rejects(views.ready(own.paneId,own.terminalId,process.pid),/registration/);
 await views.register(own.paneId,own.terminalId,process.pid);assert.equal((await views.records())[0].ready,false);
 await assert.rejects(views.ready(own.paneId,own.terminalId,process.pid+1),/registration/);
 pane={...pane,terminal_id:'reused-term'};await assert.rejects(views.ready(own.paneId,own.terminalId,process.pid),/identity changed/);
 pane={...pane,terminal_id:own.terminalId};await views.ready(own.paneId,own.terminalId,process.pid);assert.equal((await views.records())[0].ready,true);
 await views.register(own.paneId,own.terminalId,process.pid);assert.equal((await views.records())[0].ready,false,'a new registration cannot inherit an old ready receipt');
});

test('activation checks every requested frontend and rejects a dead child or a reused pane even when the collector is ready',async t=>{
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-ready-all-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=new StateStore(directory);
 const other={...record,paneId:'other',terminalId:'other-term',targetTerminalId:'other-native',pid:process.pid,ready:false};
 let records=[{...record,pid:process.pid,ready:true},other];await store.write('views',records);
 let snapshot=records.map(row=>({pane_id:row.paneId,terminal_id:row.terminalId,tab_id:row.tabId}));const rpc={call:async<T>()=>({snapshot:{panes:snapshot}} as T)};
 const requested=records.map(row=>({paneId:row.paneId,terminalId:row.terminalId}));
 assert.equal(await panels.requestedViewsReady(store,rpc,requested),false,'one ready frontend cannot satisfy a second unpainted frontend');
 records[1].ready=true;await store.write('views',records);assert.equal(await panels.requestedViewsReady(store,rpc,requested),true);
 const child=spawn(process.execPath,['-e',''],{stdio:'ignore'});await once(child,'exit');records[1].pid=child.pid!;await store.write('views',records);
 assert.equal(await panels.requestedViewsReady(store,rpc,requested),false,'a receipt from a child that already exited does not satisfy activation');
 records[1].pid=process.pid;await store.write('views',records);snapshot[1].terminal_id='reused-terminal';assert.equal(await panels.requestedViewsReady(store,rpc,requested),false);
 snapshot[1].terminal_id=other.terminalId;snapshot=[];assert.equal(await panels.requestedViewsReady(store,rpc,requested),false,'a painted child whose pane is gone does not satisfy activation');
});
