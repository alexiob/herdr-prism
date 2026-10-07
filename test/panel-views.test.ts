import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {rm} from 'node:fs/promises';
import {freshPrivateDirectory} from './helpers/private-dir.ts';
import {StateStore} from '../src/state/store.ts';
import {MailboxServer,MailboxClient} from '../src/state/mailbox.ts';
import {validateRequest} from '../src/herdr/schema.ts';

test('shared view data uses an explicitly bounded larger response without widening request limits',async t=>{
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-view-mailbox-'));const server=new MailboxServer(directory,'token',async()=>({text:'x'.repeat(1100000)}));
 await server.start();t.after(async()=>{await server.close();await rm(directory,{recursive:true,force:true});});
 const client=new MailboxClient(directory,'token',5000,16*1024*1024);assert.equal((await client.request('snapshot')).text.length,1100000);
 await assert.rejects(new MailboxClient(directory,'token').request('snapshot'),/Invalid mailbox file/);
});

test('agent tabs keep independent panels and closed state without moving another panel',async t=>{
 const {PanelViews}=await import('../src/runtime/panel-views.ts');
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-views-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const panes:any[]=[{pane_id:'claude',terminal_id:'claude-term',tab_id:'claude-tab'},{pane_id:'codex',terminal_id:'codex-term',tab_id:'codex-tab'}],calls:string[]=[];
 const rpc={call:async(method:string,p:any={})=>{calls.push(method);if(method==='session.snapshot')return{snapshot:{panes,focused_pane_id:'codex'}};if(method==='plugin.pane.open'){const target=panes.find(pane=>pane.pane_id===p.target_pane_id),pane={pane_id:'prism-'+panes.length,terminal_id:'term-'+panes.length,tab_id:target.tab_id};panes.push(pane);return{plugin_pane:{plugin_id:'iob.herdr-prism',entrypoint:'inspector',pane}};}if(method==='plugin.pane.focus')return{focused:p.pane_id};throw Error('Unexpected '+method);}};
 const views=new PanelViews(new StateStore(directory),rpc as any);
 const claude=await views.open('claude'),codex=await views.open('codex');
 assert.notEqual(claude.plugin_pane.pane.terminal_id,codex.plugin_pane.pane.terminal_id);
 assert.equal(panes.filter(p=>p.tab_id==='claude-tab').length,2);assert.equal(panes.filter(p=>p.tab_id==='codex-tab').length,2);
 await views.open('claude');assert.equal(calls.filter(m=>m==='plugin.pane.open').length,2);assert.ok(!calls.includes('pane.move'));
 await views.closed(claude.plugin_pane.pane.terminal_id);panes.splice(panes.findIndex(p=>p.terminal_id===claude.plugin_pane.pane.terminal_id),1);
 const records=await views.records();assert.equal(records.find(r=>r.tabId==='claude-tab')?.open,false);assert.equal(records.find(r=>r.tabId==='codex-tab')?.open,true);
 await views.open('codex');assert.equal(calls.filter(m=>m==='plugin.pane.open').length,2);
 await views.open('claude');assert.equal(calls.filter(m=>m==='plugin.pane.open').length,3);
});

test('panel registry enforces its bound before opening another native pane',async t=>{
 const {PanelViews}=await import('../src/runtime/panel-views.ts');const directory=await freshPrivateDirectory(join(tmpdir(),'prism-view-bound-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=new StateStore(directory);await store.write('views',Array.from({length:128},(_,i)=>({tabId:'tab-'+i,paneId:'pane-'+i,terminalId:'term-'+i,open:true})));
 let opened=false;const rpc={call:async(method:string)=>{if(method==='session.snapshot')return{snapshot:{panes:[{pane_id:'new-agent',terminal_id:'native',tab_id:'new-tab'}]}};opened=true;throw Error('Unexpected native mutation');}};
 await assert.rejects(new PanelViews(store,rpc as any).open('new-agent'),/panel limit/);assert.equal(opened,false);
});

test('authoritative maintenance stops heavy collection after a view disappears without closing cleanly',async t=>{
 const {CollectorHost}=await import('../src/runtime/collector-service.ts');const directory=await freshPrivateDirectory(join(tmpdir(),'prism-view-visible-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=new StateStore(directory);await store.write('views',[{tabId:'tab',paneId:'prism',terminalId:'view-term',open:true}]);
 let panes:any[]=[{pane_id:'prism',terminal_id:'view-term',tab_id:'tab'}],visible=false,scopes=0;
 const collector={data:{sessions:[],stale:false},setVisibleSelections(values:any[]){visible=values.length>0;if(values.length)scopes++;},dataForView(){return this.data;}};
 const rpc={call:async()=>({snapshot:{agents:[],panes,focused_tab_id:'tab'}})};const host=new CollectorHost(collector as any,store,rpc as any);
 await host.request('view.poll',{terminalId:'view-term',key:'session',visible:true,subtree:false,expanded:false});assert.equal(visible,true);
 await host.request('view.poll',{terminalId:'view-term',key:'session',visible:true,subtree:false,expanded:false});assert.equal(scopes,2,'the collector receives the complete visible set; it deduplicates unchanged sampling preferences');
 panes=[];await host.request('maintenance');assert.equal(visible,false);assert.equal((await host.views.records())[0].open,false);
});

test('view preferences and view leases are isolated while the server keeps one collector lease',async t=>{
 const {panelViewStore}=await import('../src/runtime/panel-views.ts');const directory=await freshPrivateDirectory(join(tmpdir(),'prism-view-prefs-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const owner=await new StateStore(directory).acquire();t.after(()=>owner.release());
 const claude=panelViewStore(directory,'claude'),codex=panelViewStore(directory,'codex');
 const first=await claude.acquire(),second=await codex.acquire();t.after(async()=>{await first.release();await second.release();});
 await claude.write('preferences',{tab:'Messages'});await codex.write('preferences',{tab:'To-do'});
 assert.deepEqual(await claude.read('preferences'),{tab:'Messages'});assert.deepEqual(await codex.read('preferences'),{tab:'To-do'});
 await assert.rejects(new StateStore(directory).acquire(),/owner is live/);
});

test('remote reference pages carry their matching content snapshot and revision',async t=>{
 const {RemoteCollector}=await import('../src/runtime/remote-collector.ts');const directory=await freshPrivateDirectory(join(tmpdir(),'prism-view-pages-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const context={configDir:directory,stateDir:directory,configPath:join(directory,'config.toml'),endpoint:'fixture',serverStateDir:join(directory,'server'),settings:{nativeMode:'inspector-only',providerHomes:{},todosEnabled:true,sampleIntervalMs:2000,follow:true,ascii:false,monochrome:false}} as any;
 await new StateStore(context.serverStateDir).write('controller',{token:'fixture',pid:process.pid});
 const original=MailboxClient.prototype.request;
 const data=(revision:string)=>({sessions:[{key:'session',evidence:{contentRevision:revision}}],updatedAt:1,stale:false,diagnostics:[]});
 (MailboxClient.prototype as any).request=async(op:string)=>op==='ping'?{kind:'collector-service',ready:true,stale:false}:op==='view.poll'?{data:data('old'),revision:'old',stale:false,snapshotRevision:1,snapshot:{protocol:22,agents:[],panes:[],focused_pane_id:'pane'}}:op==='page-references'?{page:{refs:[],hasMore:false,partial:false,observedAt:1},data:data('new'),contentRevision:'new'}:{};
 const view=new RemoteCollector(context,'pane','terminal');
 try{await view.start();const page=await view.pageReferences('session');assert.equal(view.data.sessions[0].evidence.contentRevision,'new');assert.equal((page as any).contentRevision,'new');assert.deepEqual(page?.refs,[]);}
 finally{await view.close();MailboxClient.prototype.request=original;}
});

test('broker excludes its current hot reference window from historical pages',async t=>{
 const {CollectorHost}=await import('../src/runtime/collector-service.ts');const directory=await freshPrivateDirectory(join(tmpdir(),'prism-view-hot-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let options:any;const collector={data:{sessions:[{key:'session',refs:[{id:'hot'}],evidence:{contentRevision:'current'}}]},pageReferences:async(_key:string,value:any)=>{options=value;return{refs:[]};}};
 const host=new CollectorHost(collector as any,new StateStore(directory),{} as any);
 await host.request('page-references',{session:'session',options:{excludeIds:['older'],limit:50}});
 assert.deepEqual(options.excludeIds,['older','hot']);
});

test('one delayed failed poll is counted once and a following successful poll recovers',async t=>{
 const {RemoteCollector}=await import('../src/runtime/remote-collector.ts');const directory=await freshPrivateDirectory(join(tmpdir(),'prism-view-recovery-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const context={configDir:directory,stateDir:directory,configPath:join(directory,'config.toml'),endpoint:'fixture',serverStateDir:join(directory,'server')} as any;
 await new StateStore(context.serverStateDir).write('controller',{token:'fixture',pid:process.pid});
 const original=MailboxClient.prototype.request;let polls=0,disconnected=0,diagnostics=0;
 const data={sessions:[],updatedAt:1,stale:false,diagnostics:[]};
 (MailboxClient.prototype as any).request=async(op:string)=>{if(op==='ping')return{kind:'collector-service',ready:true,stale:false};if(op==='view.poll'){if(++polls===2){await new Promise(resolve=>setTimeout(resolve,1300));throw Error('temporary failure');}return{data,revision:'fixture',stale:false,snapshotRevision:1,snapshot:{protocol:22,agents:[],panes:[],focused_pane_id:'pane'}};}return{};};
 const view=new RemoteCollector(context,'pane','terminal');view.setVisibleSession('session',true);view.on('disconnected',()=>disconnected++);view.on('diagnostic',()=>diagnostics++);
 try{await view.start();await new Promise(resolve=>setTimeout(resolve,2600));assert.equal(disconnected,0);assert.equal(diagnostics,1);assert.ok(polls>=3);assert.equal(view.data.stale,false);}
 finally{await view.close();MailboxClient.prototype.request=original;}
});

test('two native terminals in the same tab each own an adjacent panel and reopening targets only its binding',async t=>{
 const {PanelViews,panelViewStore}=await import('../src/runtime/panel-views.ts');const directory=await freshPrivateDirectory(join(tmpdir(),'prism-same-tab-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const panes:any[]=[{pane_id:'a',terminal_id:'ta',tab_id:'tab'},{pane_id:'b',terminal_id:'tb',tab_id:'tab'}],opens:any[]=[];
 const rpc={call:async(method:string,p:any={})=>{if(method==='session.snapshot')return{snapshot:{panes,focused_pane_id:'b'}};if(method==='plugin.pane.focus')return{focused:p.pane_id};if(method==='plugin.pane.open'){opens.push(p);const pane={pane_id:'panel-'+opens.length,terminal_id:'view-'+opens.length,tab_id:'tab'};panes.push(pane);return{plugin_pane:{plugin_id:'iob.herdr-prism',entrypoint:'inspector',pane}};}throw Error(method);}};
 const views=new PanelViews(new StateStore(directory),rpc as any);await views.open('a');await views.open('b');assert.equal(opens.length,2);assert.deepEqual(opens.map(p=>[p.target_pane_id,p.direction]),[['a','right'],['b','right']]);
 assert.equal((await views.open('a')).focused,'panel-1');assert.equal((await views.open('b')).focused,'panel-2');assert.equal((await views.open('panel-1')).focused,'panel-1');assert.equal(opens.length,2);
 const first=panelViewStore(directory,'tab','ta'),second=panelViewStore(directory,'tab','tb'),firstLease=await first.acquire(),secondLease=await second.acquire();t.after(async()=>{await firstLease.release();await secondLease.release();});
 await first.write('preferences',{selectedKey:'a',tab:'Messages',pin:true,readers:[['a',{cursor:3}]]});await second.write('preferences',{selectedKey:'b',tab:'Notes',pin:false});assert.equal((await first.read<any>('preferences'))?.selectedKey,'a');assert.equal((await second.read<any>('preferences'))?.tab,'Notes');
 await views.closed('view-1');panes.splice(panes.findIndex(p=>p.terminal_id==='view-1'),1);await views.open('a');assert.equal(opens.length,3);assert.equal((await views.records()).length,2);assert.equal((await views.open('b')).focused,'panel-2');
});

test('default panels are narrow and user widths persist independently through reopen and controller replacement without adopting window resize',async t=>{
 const {PanelViews,panelViewStore}=await import('../src/runtime/panel-views.ts');const directory=await freshPrivateDirectory(join(tmpdir(),'prism-panel-width-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=new StateStore(directory);
 const native=[{pane_id:'a',terminal_id:'ta',tab_id:'tab'},{pane_id:'b',terminal_id:'tb',tab_id:'tab'}],panels:any[]=[],ratios=new Map<string,number>();let regionWidth=200,opened=0;
 const leaf=(pane_id:string)=>({type:'pane',pane_id}),root=()=>({type:'split',direction:'down',ratio:0.5,first:node('a'),second:node('b')}),node=(target:string):any=>{const panel=panels.find(p=>p.target===target);return panel?{type:'split',direction:'right',ratio:ratios.get(target),first:leaf(target),second:leaf(panel.pane_id)}:leaf(target);};
 const snapshot=()=>({panes:[...native,...panels],focused_pane_id:'a',layouts:[{tab_id:'tab',panes:native.flatMap((target,i)=>{const panel=panels.find(p=>p.target===target.pane_id),width=panel?Math.floor(regionWidth*ratios.get(target.pane_id)!):regionWidth;return[{pane_id:target.pane_id,rect:{x:0,y:i*40,width,height:40}},...panel?[{pane_id:panel.pane_id,rect:{x:width,y:i*40,width:regionWidth-width,height:40}}]:[]];}),splits:panels.map(panel=>({id:'split-'+panel.target,direction:'right',ratio:ratios.get(panel.target),rect:{x:0,y:panel.target==='a'?0:40,width:regionWidth,height:40}}))}]});
 const rpc={call:async(method:string,p:any={})=>{validateRequest(method,p);if(method==='session.snapshot')return{snapshot:snapshot()};if(method==='plugin.pane.open'){const pane={pane_id:'panel-'+(++opened),terminal_id:'view-'+opened,tab_id:'tab',target:p.target_pane_id};panels.push(pane);ratios.set(p.target_pane_id,0.5);return{plugin_pane:{plugin_id:'iob.herdr-prism',entrypoint:'inspector',pane}};}if(method==='layout.export')return{layout:{root:root()}};if(method==='layout.set_split_ratio'){assert.deepEqual(p.path,p.pane_id===panels.find(v=>v.target==='a')?.pane_id?[false]:[true]);const panel=panels.find(v=>v.pane_id===p.pane_id);ratios.set(panel.target,p.ratio);return{};}if(method==='plugin.pane.focus')return{};throw Error(method);}};
 let views=new PanelViews(store,rpc as any);await views.open('a');await views.open('b');const width=(target:string)=>snapshot().layouts[0].panes.find(p=>p.pane_id===panels.find(v=>v.target===target)?.pane_id)!.rect.width;
 assert.equal(width('a'),60);assert.equal(width('b'),60);assert.equal((await panelViewStore(directory,'tab','ta').read<any>('panel-size')).columns,60);
 ratios.set('a',0.625);await views.observeWidths(snapshot());assert.equal((await panelViewStore(directory,'tab','ta').read<any>('panel-size')).columns,75);assert.equal((await panelViewStore(directory,'tab','tb').read<any>('panel-size')).columns,60);
 regionWidth=240;await views.observeWidths(snapshot());assert.equal(width('a'),90);assert.equal((await panelViewStore(directory,'tab','ta').read<any>('panel-size')).columns,75,'window and outer-layout resizing never overwrite the desired user width');
 const old=panels.find(p=>p.target==='a');await views.closed(old.terminal_id);panels.splice(panels.indexOf(old),1);views=new PanelViews(new StateStore(directory),rpc as any);await views.open('a');assert.ok(Math.abs(width('a')-75)<=1);assert.equal(width('b'),72,'reopening one bound panel does not resize its neighbor');
 await views.observeWidths(snapshot());ratios.set('b',0.65);await views.closed(panels.find(p=>p.target==='b').terminal_id);assert.equal((await panelViewStore(directory,'tab','tb').read<any>('panel-size')).columns,84,'immediate close flushes a resize before a maintenance poll');
 regionWidth=80;const a=panels.find(p=>p.target==='a');await views.closed(a.terminal_id);panels.splice(panels.indexOf(a),1);await views.open('a');assert.ok(width('a')<=48,'restore leaves at least32 columns for the native agent');assert.equal((await panelViewStore(directory,'tab','ta').read<any>('panel-size')).columns,75,'a constrained reopen preserves the preferred width for future larger regions');
});

test('view inspection reports only its owned binding and selected resource summary without changing visibility or returning private content',async t=>{
 const {CollectorHost}=await import('../src/runtime/collector-service.ts');const directory=await freshPrivateDirectory(join(tmpdir(),'prism-view-inspect-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=new StateStore(directory);await store.write('views',[{tabId:'tab',paneId:'panel',terminalId:'view',targetTerminalId:'native-term',open:true}]);
 const agent={pane_id:'native',terminal_id:'native-term',tab_id:'tab',agent:'codex',agent_session:{kind:'id',value:'bound'}};let focusedTab='tab',visibilityUpdates=0;
 const session={key:'claude:child',evidence:{provider:'claude',state:'unknown',messages:[{text:'PRIVATE TRANSCRIPT FIXTURE'}],tools:[{text:'PRIVATE TOOL FIXTURE'}]},notes:'PRIVATE NOTES FIXTURE',attachments:[],resource:{availability:'unavailable',reason:'No verified live process',processes:[],coverage:{readable:0,total:0},cpuCoverage:{readable:0,total:0},sampledAt:123},history:{points:[{at:122,cpuPercent:50,memoryBytes:'1234'},{at:123}],cpu:[50,undefined],memory:['1234',undefined],peakMemoryBytes:'1234',observedFrom:122,observedTo:123,windowMs:900000}};
 const collector={data:{sessions:[{key:'codex:bound',attachment:agent},session]},setVisibleSelections(){visibilityUpdates++;},dataForView(){return this.data;},refresh(){throw Error('Inspection cannot refresh');},sampleProcesses(){throw Error('Inspection cannot sample');}};
 const rpc={call:async(method:string)=>{assert.equal(method,'session.snapshot');return{snapshot:{agents:[agent],panes:[agent,{pane_id:'panel',terminal_id:'view',tab_id:'tab'}],focused_tab_id:focusedTab}};}};const host=new CollectorHost(collector as any,store,rpc as any);
 await host.request('view.poll',{terminalId:'view',key:'claude:child',visible:true,subtree:false,expanded:false});const updates=visibilityUpdates;
 const result=await host.request('view.inspect',{terminalId:'view'});assert.equal(result.boundSessionKey,'codex:bound');assert.equal(result.key,'claude:child');assert.equal(result.reportedVisible,true);assert.equal(result.actualVisible,true);assert.equal(result.selected.attachmentCount,0);assert.equal(result.selected.resource.reason,'No verified live process');assert.equal(result.selected.history.knownCpuPoints,1);assert.equal(result.selected.history.pointCount,2);assert.equal(visibilityUpdates,updates);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
 focusedTab='other';const hidden=await host.request('view.inspect',{terminalId:'view'});assert.equal(hidden.reportedVisible,true);assert.equal(hidden.actualVisible,false);assert.equal(visibilityUpdates,updates,'read-only inspection must not alter the collector gate');await assert.rejects(host.request('view.inspect',{terminalId:'foreign'}),/Unowned/);
});
