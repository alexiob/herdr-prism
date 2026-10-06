import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {writeFile,rm} from 'node:fs/promises';
import {freshPrivateDirectory} from './helpers/private-dir.ts';
import {loadSettings} from '../src/config/index.ts';
import {tabs} from '../src/tui/types.ts';
import {createUiState,renderScreen,handleKey,handleRowClick} from '../src/tui/screen.ts';
import {demoData} from '../src/runtime/demo.ts';
import {Collector} from '../src/runtime/collector.ts';
import {CollectorHost} from '../src/runtime/collector-service.ts';
import {StateStore,identityName} from '../src/state/store.ts';
import {MailboxServer} from '../src/state/mailbox.ts';
import {main as action} from '../src/entrypoints/action.ts';

const expected=['Overview','Notes','To-do','Git','Agents','Processes','Refs','Messages'];
test('default tab order matches the requested sequence with Messages last',()=>assert.deepEqual([...tabs],expected));
test('settings accept a UI tab order, normalize names and append omitted tabs without losing views',async t=>{
 const dir=await freshPrivateDirectory(join(tmpdir(),'prism-tab-config-'));t.after(()=>rm(dir,{recursive:true,force:true}));assert.deepEqual((await loadSettings(dir) as any).ui.tabOrder,expected);
 await writeFile(join(dir,'settings.json'),JSON.stringify({follow:false,ui:{tabOrder:['git','To-Do','Notes']}}));const loaded=await loadSettings(dir) as any;assert.equal(loaded.follow,false);assert.deepEqual(loaded.ui.tabOrder,['Git','To-do','Notes','Overview','Agents','Processes','Refs','Messages']);
 loaded.ui.tabOrder.reverse();assert.deepEqual((await loadSettings(dir) as any).ui.tabOrder,['Git','To-do','Notes','Overview','Agents','Processes','Refs','Messages']);
});
test('invalid UI orders fail clearly instead of silently dropping or duplicating tabs',async t=>{
 const dir=await freshPrivateDirectory(join(tmpdir(),'prism-tab-invalid-'));t.after(()=>rm(dir,{recursive:true,force:true}));for(const ui of [null,[],{tabOrder:[]},{tabOrder:'Git'},{tabOrder:['bad']},{tabOrder:['Git','git']},{tabOrder:[1]},{nativeGrouping:'unknown'}]){await writeFile(join(dir,'settings.json'),JSON.stringify({ui}));await assert.rejects(loadSettings(dir),/ui|tabOrder/i);}
});
test('configured order controls chrome, both keyboard directions and mouse targets at all widths',()=>{
 const data=demoData() as any;data.tabOrder=['Overview','Git','Notes','To-do','Messages','Refs','Processes','Agents'];const state=createUiState();state.selectedKey=data.sessions[0].key;
 for(const width of [26,36,80,120]){let frame=renderScreen(data,state,width,24);assert.deepEqual(frame.tabRegions!.map(r=>r.tab),data.tabOrder);state.tab='Overview';frame=renderScreen(data,state,width,24);handleKey(state,'tab',data,frame);assert.equal(state.tab,'Git');frame=renderScreen(data,state,width,24);handleKey(state,'shift+tab',data,frame);assert.equal(state.tab,'Overview');const region=frame.tabRegions!.find(r=>r.tab==='Notes')!;handleRowClick(state,region.x,region.y,data,frame);assert.equal(state.tab,'Notes');}
});
test('live reorder preserves the selected view, reader anchor and an open confirmation target',()=>{
 const data=demoData() as any,state=createUiState();state.selectedKey=data.sessions[0].key;state.tab='Processes';state.cursorId=data.sessions[0].resource.processes[1].key;let frame=renderScreen(data,state,80,34);const anchor=state.cursorId;
 data.tabOrder=[...expected].reverse();frame=renderScreen(data,state,80,34);assert.equal(state.tab,'Processes');assert.equal(state.cursorId,anchor);handleKey(state,'K',data,frame);const captured=structuredClone(state.processConfirmation);data.tabOrder=expected;frame=renderScreen(data,state,80,34);assert.deepEqual(state.processConfirmation,captured);handleKey(state,'escape',data,frame);assert.equal(state.cursorId,anchor);
});
test('broker applies a validated UI order without starting sampling and keeps it across snapshots',async t=>{
 const dir=await freshPrivateDirectory(join(tmpdir(),'prism-tab-reload-'));t.after(()=>rm(dir,{recursive:true,force:true}));let samples=0;
 const settings=await loadSettings(dir),index={setActiveRefs(){},setDetailedRefs(){},async refreshSnapshots(){return[];},diagnostics:[],close(){}};
 const collector=new Collector({settings:{...settings,nativeMode:'inspector-only'},stateDir:dir,rpc:{async call(){return{snapshot:{agents:[]}};}} as any,index:index as any,git:{close(){}} as any,sampler:{async sample(){samples++;throw Error('must not sample');},async close(){}}});t.after(()=>collector.close({clearNative:false}));const host=new CollectorHost(collector,new StateStore(dir),{} as any);
 const order=[...expected].reverse();await host.request('reload-settings',{tabOrder:order,nativeGrouping:'project'});assert.equal(collector.settings.ui?.nativeGrouping,'project');assert.deepEqual((collector.data as any).tabOrder,order);await collector.refresh();assert.deepEqual((collector.data as any).tabOrder,order);assert.equal(samples,0);
 await assert.rejects(host.request('reload-settings',{tabOrder:['bad']}));assert.deepEqual((collector.data as any).tabOrder,order);
});
test('reload-settings action reads the actual plugin file and delivers it to the existing server',async t=>{
 const dir=await freshPrivateDirectory(join(tmpdir(),'prism-tab-action-'));t.after(()=>rm(dir,{recursive:true,force:true}));const endpoint='fixture',serverDir=join(dir,'servers',identityName(endpoint)),order=[...expected].reverse();await writeFile(join(dir,'settings.json'),JSON.stringify({ui:{tabOrder:order}}));await new StateStore(serverDir).write('controller',{pid:process.pid,token:'fixture'});
 let received:any;const mailbox=new MailboxServer(serverDir,'fixture',async(op,p)=>{received={op,p};return{reloaded:true,tabOrder:p.tabOrder};});await mailbox.start();t.after(()=>mailbox.close());
 const result=await action(['reload-settings','--config-dir',dir,'--state-dir',dir,'--socket',endpoint]);assert.equal((result as any).reloaded,true);assert.equal(received.op,'reload-settings');assert.deepEqual(received.p.tabOrder,order);
});
