import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {rm} from 'node:fs/promises';
import {freshPrivateDirectory} from './helpers/private-dir.ts';
import {StateStore} from '../src/state/store.ts';
import {MailboxServer,MailboxClient} from '../src/state/mailbox.ts';

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
 const collector={data:{sessions:[],stale:false},setVisibleSession:(_key:any,value:boolean)=>{visible=value;},setScope(){scopes++;},setProcessesExpanded(){}};
 const rpc={call:async()=>({snapshot:{panes,focused_tab_id:'tab'}})};const host=new CollectorHost(collector as any,store,rpc as any);
 await host.request('view.poll',{terminalId:'view-term',key:'session',visible:true,subtree:false,expanded:false});assert.equal(visible,true);
 await host.request('view.poll',{terminalId:'view-term',key:'session',visible:true,subtree:false,expanded:false});assert.equal(scopes,1,'polling must not repeatedly reset the sampling deadline');
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
 (MailboxClient.prototype as any).request=async(op:string)=>op==='ping'?{kind:'collector-service',ready:true,stale:false}:op==='view.poll'?{data:data('old')}:op==='page-references'?{page:{refs:[],hasMore:false,partial:false,observedAt:1},data:data('new'),contentRevision:'new'}:{};
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
 (MailboxClient.prototype as any).request=async(op:string)=>{if(op==='ping')return{kind:'collector-service',ready:true,stale:false};if(op==='view.poll'){if(++polls===2){await new Promise(resolve=>setTimeout(resolve,1300));throw Error('temporary failure');}return{data};}return{};};
 const view=new RemoteCollector(context,'pane','terminal');view.on('disconnected',()=>disconnected++);view.on('diagnostic',()=>diagnostics++);
 try{await view.start();await new Promise(resolve=>setTimeout(resolve,2600));assert.equal(disconnected,0);assert.equal(diagnostics,1);assert.ok(polls>=3);assert.equal(view.data.stale,false);}
 finally{await view.close();MailboxClient.prototype.request=original;}
});
