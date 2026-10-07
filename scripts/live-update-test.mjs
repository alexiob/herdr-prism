import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,open,lstat,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {stageRelease} from './release.mjs';
import {checkInstall} from './check-install.mjs';

const exec=promisify(execFile),pluginId='iob.herdr-prism';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const quote=value=>process.platform==='win32'?"'"+value.replaceAll("'","''")+"'":"'"+value.replaceAll("'","'\\''")+"'";
async function until(label,probe,timeoutMs=30000){
 const deadline=Date.now()+timeoutMs;let last;
 while(Date.now()<deadline){try{const value=await probe();if(value)return value;}catch(error){last=error;}await delay(100);}
 throw Error(`${label} timed out${last?': '+last.message:''}`);
}

/** Reader caches can gain an untouched entry while shutdown flushes a newly
 * hydrated evidence-path identity. Preserve every previous choice by its key;
 * insertion order is a cache detail, and new entries must still be defaults. */
export function assertPreferencesPreserved(actual,expected){
 assert.ok(actual&&typeof actual==='object'&&!Array.isArray(actual),'current preferences exist');
 assert.ok(expected&&typeof expected==='object'&&!Array.isArray(expected),'captured preferences exist');
 const {readers:after=[],...actualFields}=actual,{readers:before=[],...expectedFields}=expected;
 assert.deepEqual(actualFields,expectedFields,'exact target UI preferences retained');
 const readerMap=(entries,label)=>{
  assert.ok(Array.isArray(entries),label+' readers are an array');const map=new Map();
  for(const tuple of entries){
   assert.ok(Array.isArray(tuple)&&tuple.length===2&&typeof tuple[0]==='string'&&tuple[0]&&tuple[1]&&typeof tuple[1]==='object'&&!Array.isArray(tuple[1]),label+' reader tuple is valid');
   assert.ok(!map.has(tuple[0]),label+' reader keys are unique');map.set(tuple[0],tuple[1]);
  }
  return map;
 };
 const previous=readerMap(before,'captured'),current=readerMap(after,'current');
 for(const [key,position]of previous){assert.ok(current.has(key),'previous reader retained: '+key);assert.deepEqual(current.get(key),position,'previous reader position retained: '+key);}
 for(const [key,position]of current)if(!previous.has(key)){
  assert.equal(position.cursor,0,'new reader starts at cursor 0: '+key);assert.equal(position.scroll,0,'new reader starts at scroll 0: '+key);
  assert.ok(position.cursorId===undefined||typeof position.cursorId==='string','new reader cursor identity is a string or absent');
  assert.ok(Object.keys(position).every(key=>['cursor','cursorId','scroll'].includes(key)),'new reader contains only default position fields');
 }
}

/** Real update engines, two named servers, private synthetic records only.
 * The supplied release is read-only. Every changed release, pane and namespace
 * belongs to this fixture; no download, build or user server is involved.
 */
export async function liveUpdateTest({release,herdr=process.env.HERDR_BIN_PATH??'herdr',proof='artifacts/live-update-proof'}={}){
 if(!release)throw Error('--release must name a reviewed checksummed release');
 release=path.resolve(release);proof=path.resolve(proof);
 if(herdr.includes('/')||herdr.includes('\\'))herdr=path.resolve(herdr);
 const checked=await checkInstall({root:release});if(!checked.ok)throw Error('Input release integrity failed: '+checked.errors.join('; '));
 const {updatePrism}=await import('./update.mjs');
 const {prepareCodeReplacement}=await import('./update-code.mjs');
 const directory=await mkdtemp(path.join(process.platform==='win32'?os.tmpdir():'/tmp','pu-'));
 await mkdir(proof,{recursive:true});
 const result={kind:'actual-isolated-herdr-update',ok:false,platform:process.platform,arch:process.arch,node:process.version,fixtureNotice:'Synthetic Pi-shaped records and private notebooks; no model, network update or user namespace.',checks:{}};
 const save=()=>writeFile(path.join(proof,'update.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
 const stage=async(label,run)=>{console.log(JSON.stringify({stage:label,status:'running'}));result.checks[label]=await run();await save();console.log(JSON.stringify({stage:label,status:'passed'}));};
 const configHome=path.join(directory,'c'),configPath=path.join(configHome,'herdr','config.toml');
 const original='[server]\nheadless_cols = 160\nheadless_rows = 45\n';
 await mkdir(path.dirname(configPath),{recursive:true});await writeFile(configPath,original,{mode:0o600});
 const providerHomes=Object.fromEntries(['codex','claude','pi'].map(provider=>[provider,path.join(directory,provider)]));
 for(const dir of Object.values(providerHomes))await mkdir(dir,{recursive:true,mode:0o700});
 const settingsDir=path.join(configHome,'herdr','plugins','config',pluginId);
 await mkdir(settingsDir,{recursive:true,mode:0o700});
 await writeFile(path.join(settingsDir,'settings.json'),JSON.stringify({providerHomes,nativeMode:'inspector-only',todosEnabled:false,sampleIntervalMs:2000}),{mode:0o600});
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('HERDR_'))delete env[key];
 Object.assign(env,{XDG_CONFIG_HOME:configHome,XDG_STATE_HOME:path.join(directory,'s'),XDG_DATA_HOME:path.join(directory,'d'),HERDR_CONFIG_PATH:configPath,TERM:'xterm-256color',CODEX_HOME:providerHomes.codex,CLAUDE_CONFIG_DIR:providerHomes.claude,PI_CODING_AGENT_DIR:providerHomes.pi});
 if(process.platform==='win32'){env.APPDATA=configHome;env.LOCALAPPDATA=path.join(directory,'local');}else env.SHELL='/bin/sh';
 const servers=[];let installed,installOptions,success=false,githubMetadata=false;
 const variant=async(label,failActivation=false)=>{
  const output=path.join(directory,'release-'+label);
  await stageRelease({root:release,output,platforms:[process.platform+'-'+process.arch],helperSource:'bin',nodeBin:process.execPath});
  const marker='dist/update-fixture.json';await writeFile(path.join(output,marker),JSON.stringify({synthetic:true,revision:label})+'\n');
  const index=JSON.parse(await readFile(path.join(output,'checksums.json'),'utf8'));
  index.files[marker]=digest(await readFile(path.join(output,marker)));
  if(failActivation){
   const action='dist/entrypoints/action.js',actionPath=path.join(output,action);
   // Exercise the real finite activation entrypoint used by updates, while
   // leaving deactivation and complete fixture cleanup operational.
   const bad="if(process.argv[2]?.startsWith('activate')&&process.argv[1]?.replaceAll(String.fromCharCode(92),'/').startsWith((process.env.HERDR_PLUGIN_ROOT??'').replaceAll(String.fromCharCode(92),'/')+'/')){process.stderr.write('SYNTHETIC activation failure');process.exit(81);}\n"+await readFile(actionPath,'utf8');
   await writeFile(actionPath,bad);index.files[action]=digest(bad);
  }
  await writeFile(path.join(output,'checksums.json'),JSON.stringify(index,null,2)+'\n');return output;
 };
 try{
  const oldRelease=await variant('old'),newRelease=await variant('new'),badRelease=await variant('activation-fails',true);
  const load=file=>import(pathToFileURL(path.join(oldRelease,file)).href);
  const {liveInstall,liveUninstall}=await load('scripts/live-install.mjs');
  const {HerdrClient}=await load('dist/herdr/client.js'),{StateStore,identityName}=await load('dist/state/store.js');
  const {panelViewStore}=await load('dist/runtime/panel-views.js'),{NotesStore}=await load('dist/state/notes.js');
  const fixtureCli=path.join(directory,'fixtures','pi');await mkdir(path.dirname(fixtureCli),{recursive:true});
  await writeFile(fixtureCli,"process.title='pi';console.log('SYNTHETIC UPDATE FIXTURE ONLY');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));setInterval(()=>{},1000);\n");
  const fixtureDirectory=path.join(providerHomes.pi,'sessions','update');await mkdir(fixtureDirectory,{recursive:true});
  for(const name of ['update-a','update-b']){
   console.log(JSON.stringify({stage:'isolatedServerSetup',session:name,status:'running'}));
   const endpoint=path.join(configHome,'herdr','sessions',name,'herdr.sock'),ownEnv={...env,HERDR_SOCKET_PATH:endpoint};
   const log=await open(path.join(proof,name+'-server.log'),'w',0o600);
   const server=spawn(herdr,['--session',name,'server'],{cwd:directory,env:ownEnv,windowsHide:true,stdio:['ignore',log.fd,log.fd]});let serverError;server.on('error',error=>{serverError=error;});
   const rpc=new HerdrClient(endpoint,{timeoutMs:3000});
   const cli=async args=>{const out=await exec(herdr,['--session',name,...args],{env:ownEnv,cwd:directory,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:4*1024*1024});return out.stdout.trim()?JSON.parse(out.stdout).result:{};};
   const snapshot=async()=>(await rpc.call('session.snapshot')).snapshot;
   const text=async paneId=>(await exec(herdr,['--session',name,'pane','read',paneId,'--source','visible','--lines','60'],{env:ownEnv,cwd:directory,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:4*1024*1024})).stdout;
   const action=async id=>{const invoked=(await cli(['plugin','action','invoke',id,'--plugin',pluginId])).log;await until(name+' '+id+' action',async()=>{const row=(await cli(['plugin','log','list','--plugin',pluginId,'--limit','256'])).logs.find(row=>row.log_id===invoked.log_id);if(row?.status==='failed')throw Error(row.stderr||row.error||'Action failed');return row?.status==='succeeded'&&row.exit_code===0;});};
   const own={name,endpoint,env:ownEnv,rpc,cli,snapshot,text,action,server,log,natives:[],notes:new Map()};servers.push(own);
   await until(name+' startup',async()=>{if(serverError)throw serverError;if(server.exitCode!==null)throw Error('Owned server exited '+server.exitCode);return snapshot();});
   const workspace=await cli(['workspace','create','--cwd',directory,'--label','Synthetic update '+name,'--focus']);
   for(const label of ['alpha','beta','gamma']){
    const native=label==='alpha'?workspace.root_pane:(await cli(['tab','create','--workspace',workspace.workspace.workspace_id,'--cwd',directory,'--label','Synthetic '+label,'--no-focus'])).root_pane;
    const id='fixture-'+name+'-'+label,file=path.join(fixtureDirectory,id+'.jsonl');
    await writeFile(file,[{type:'session',version:3,id,cwd:directory,timestamp:new Date().toISOString()},{type:'session_info',id:'info',name:id},{type:'message',id:'first',timestamp:new Date().toISOString(),message:{role:'assistant',content:[{type:'text',text:'SYNTHETIC UPDATE MESSAGE '+id}],stopReason:'stop'}}].map(row=>JSON.stringify(row)+'\n').join(''));
    const command=(process.platform==='win32'?'& ':'exec ')+quote(process.execPath)+' '+quote(fixtureCli)+' --session '+quote(file);
    await cli(['pane','run',native.pane_id,command]);await until('synthetic pi process',async()=>(await snapshot()).agents.some(agent=>agent.terminal_id===native.terminal_id&&agent.agent==='pi'));
    await rpc.call('pane.report_agent',{pane_id:native.pane_id,source:'herdr:pi',agent:'pi',state:'working',agent_session_path:file,seq:100});
    await rpc.call('pane.report_agent_session',{pane_id:native.pane_id,source:'herdr:pi',agent:'pi',agent_session_path:file,session_start_source:'startup',seq:101});
    await until('synthetic conversation bound',async()=>(await snapshot()).agents.some(agent=>agent.terminal_id===native.terminal_id&&agent.agent_session?.value===file));
    own.natives.push({...native,label,key:'pi:'+id});
   }
   if(name==='update-a'){
    own.shell=(await cli(['tab','create','--workspace',workspace.workspace.workspace_id,'--cwd',directory,'--label','Ordinary fixture shell','--no-focus'])).root_pane;
    assert.ok(!(await snapshot()).agents.some(agent=>agent.terminal_id===own.shell.terminal_id),'ordinary shell is not reported or detected as an agent');
   }
   console.log(JSON.stringify({stage:'isolatedServerSetup',session:name,status:'passed'}));
  }
  // Herdr0.9.3 admits GitHub source metadata only for its exact legacy managed
  // checkout namespace. Use that owned fixture path from the initial install.
  const managedDir=path.join(configHome,'herdr','plugins','github',pluginId+'-'+digest(pluginId).slice(0,12));
  installOptions={root:oldRelease,managedDir,herdrBin:herdr,session:servers[0].name,env:servers[0].env,inspectorOnly:true,shortcut:false,timeoutMs:30000};
  installed=await liveInstall(installOptions);
  const config=new StateStore(installed.configDir);
  for(const own of servers){
   console.log(JSON.stringify({stage:'syntheticPanelSetup',session:own.name,status:'running'}));
   own.store=new StateStore(path.join(installed.stateDir,'servers',identityName(own.endpoint)));
   own.noteStore=new NotesStore(own.store.dir);
   own.view=async native=>{const views=await own.store.read('views')??[],row=views.find(row=>row.targetTerminalId===native.terminal_id&&row.open);return row&&(await own.snapshot()).panes.find(pane=>pane.terminal_id===row.terminalId);};
   own.preferences=native=>panelViewStore(own.store.dir,native.tab_id,native.terminal_id);
   if(own!==servers[0])await own.action('activate-inspector');
   for(const [index,native] of own.natives.entries()){
    await own.rpc.call('agent.focus',{target:native.pane_id});await own.action('open');
    const panel=await until('rendered target view',async()=>{const pane=await own.view(native);return pane&&(await own.text(pane.pane_id)).includes('Overview')&&pane;});
    await until('canonical fixture owner in panel',async()=>(await own.text(panel.pane_id)).includes(native.key.slice(3)));
    const desired=42+index*7+(own===servers[1]?2:0),snapshot=await own.snapshot();
    const layout=snapshot.layouts.find(layout=>layout.tab_id===native.tab_id),rect=layout.panes.find(pane=>pane.pane_id===panel.pane_id).rect;
    const tree=(await own.rpc.call('layout.export',{pane_id:panel.pane_id})).layout.root;
    const find=(node,path=[])=>node?.type!=='split'?undefined:node.direction==='right'&&node.first?.pane_id===native.pane_id&&node.second?.pane_id===panel.pane_id?{path,ratio:node.ratio}:find(node.first,[...path,false])??find(node.second,[...path,true]);
    const split=find(tree),region=layout.splits.filter(split=>split.direction==='right'&&split.rect.x<=rect.x&&split.rect.x+split.rect.width>=rect.x+rect.width&&split.rect.y<=rect.y&&split.rect.y+split.rect.height>=rect.y+rect.height).sort((a,b)=>a.rect.width*a.rect.height-b.rect.width*b.rect.height)[0];assert.ok(split&&region);
    await own.rpc.call('layout.set_split_ratio',{pane_id:panel.pane_id,path:split.path,ratio:split.ratio+(rect.width-desired)/region.rect.width});
    await until('custom target width persisted',async()=>{const size=await own.preferences(native).read('panel-size');return size?.custom&&Math.abs(size.columns-desired)<=1;});
    // Pin saves the current reader preferences. Select the tab first so the
    // baseline compares persisted preferences rather than only in-memory UI.
    await own.cli(['pane','send-text',panel.pane_id,index===2?'\t\t\t\t\t\t\tp':'\tp']);
    await until('target preference persisted',async()=>{const value=await own.preferences(native).read('preferences');return value?.pin===true&&value.tab===(index===2?'Messages':'Notes');});
    const markdown='# Synthetic update notebook\n\n'+native.key+'\n';await own.noteStore.save(native.key,markdown,null);own.notes.set(native.key,markdown);
    if(index===1){await own.cli(['pane','send-text',panel.pane_id,'q']);await until('beta closed',async()=>!(await own.view(native)));}
   }
   console.log(JSON.stringify({stage:'syntheticPanelSetup',session:own.name,status:'passed'}));
  }
  const projection=rows=>rows.map(row=>({tabId:row.tabId,targetTerminalId:row.targetTerminalId,open:row.open})).sort((a,b)=>a.targetTerminalId.localeCompare(b.targetTerminalId));
  const capture=async()=>{
   const captures=[];
   for(const own of servers){
    const snapshot=await own.snapshot(),views=await own.store.read('views'),focused=snapshot.panes.find(pane=>pane.pane_id===snapshot.focused_pane_id),view=views.find(row=>row.open&&row.terminalId===focused?.terminal_id);
    assert.ok(focused);const targets=[];
    for(const native of own.natives){const pane=await own.view(native);targets.push({native,preferences:await own.preferences(native).read('preferences'),size:await own.preferences(native).read('panel-size'),width:pane?snapshot.layouts.find(layout=>layout.tab_id===native.tab_id).panes.find(row=>row.pane_id===pane.pane_id).rect.width:null});}
    captures.push({own,views:projection(views),targets,controller:await own.store.read('controller'),focus:view?{type:'plugin',targetTerminalId:view.targetTerminalId,tabId:view.tabId}:{type:'native',paneId:focused.pane_id,terminalId:focused.terminal_id,tabId:focused.tab_id}});
   }
   return{servers:captures,settings:await config.read('settings'),shortcut:await config.read('shortcut-preference'),configText:await readFile(configPath,'utf8'),receipt:await readFile(path.join(installed.managedDir,'.hat-managed-install.json'),'utf8')};
  };
  const verify=async(before,{active=true,restarted=true}={})=>{
   assert.deepEqual(await config.read('settings'),before.settings,'exact settings, native mode and autostart retained');
   assert.deepEqual(await config.read('shortcut-preference'),before.shortcut,'shortcut opt-out retained');
   assert.equal(await readFile(configPath,'utf8'),before.configText,'exact native configuration retained');
   assert.equal(await readFile(path.join(installed.managedDir,'.hat-managed-install.json'),'utf8'),before.receipt,'managed ownership receipt retained');
   for(const saved of before.servers){const {own}=saved;
    await until('remembered views restored',async()=>{const rows=await own.store.read('views');if(active)return rows&&projection(rows).every(row=>!row.open||row.targetTerminalId)&&rows.filter(row=>row.open).every(row=>row.ready);return !(await own.store.read('controller'));});
    assert.deepEqual(projection(await own.store.read('views')),saved.views,'open and closed targets retained on '+own.name);
    const snapshot=await own.snapshot(),controller=await own.store.read('controller');
    if(active){assert.ok(controller);if(restarted)assert.notEqual(controller.pid,saved.controller.pid);}else assert.equal(controller,undefined);
    assert.equal(own.server.exitCode,null,'native named server stays running');
    for(const target of saved.targets){
     assertPreferencesPreserved(await own.preferences(target.native).read('preferences'),target.preferences);
     assert.deepEqual(await own.preferences(target.native).read('panel-size'),target.size,'exact target width preference retained');
     const panel=await own.view(target.native);if(active&&target.width!==null){
      assert.ok(panel);assert.equal(snapshot.layouts.find(layout=>layout.tab_id===target.native.tab_id).panes.find(row=>row.pane_id===panel.pane_id).rect.width,target.width,'exact target layout width restored');
      // When an ordinary shell tab is focused, every Prism view on that server
      // is hidden and deliberately pauses provider hydration and body reads.
      // Certify visible readers without disturbing the focus being tested.
      if(target.native.tab_id===snapshot.focused_tab_id){
       await until('visible restored panel displays its exact owner',async()=>(await own.text(panel.pane_id)).includes(target.native.key.slice(3)));
       if(target.preferences?.tab==='Notes'){
        const marker=own.notes.get(target.native.key).startsWith('SYNTHETIC external')?'SYNTHETIC external authoritative':'Synthetic update notebook';
        await until('visible restored Notes show their owner notebook',async()=>(await own.text(panel.pane_id)).includes(marker));
       }
      }
     }else assert.equal(panel,undefined);
    }
    const focused=snapshot.panes.find(pane=>pane.pane_id===snapshot.focused_pane_id);assert.ok(focused);
    if(saved.focus.type==='native'){assert.equal(focused.pane_id,saved.focus.paneId);assert.equal(focused.terminal_id,saved.focus.terminalId);}else{const rows=await own.store.read('views'),view=rows.find(row=>row.terminalId===focused.terminal_id);assert.equal(view?.targetTerminalId,saved.focus.targetTerminalId);assert.equal(focused.tab_id,saved.focus.tabId);}
    for(const [key,text] of own.notes)assert.equal((await own.noteStore.load(key)).text,text,'private synthetic Notes retained');
   }
  };
  const update=async(source,{moveShellFocusAfterReplace=false,revision,ref}={})=>{
   const info=(await servers[0].cli(['plugin','list','--plugin',pluginId,'--json'])).plugins[0];assert.ok(info);
   let transaction=await prepareCodeReplacement({release:source,info,herdrBin:herdr,session:servers[0].name,env:servers[0].env,nodeBin:process.execPath,revision,ref});
   if(moveShellFocusAfterReplace){
    const prepared=transaction;
    transaction={...prepared,replace:async(...args)=>{
     const replaced=await prepared.replace(...args);
     // Deliberately move this fixture's focus after the real code swap, so a
     // skipped restoration cannot accidentally satisfy the shell regression.
     await servers[0].rpc.call('pane.focus',{pane_id:servers[0].natives[0].pane_id});
     assert.notEqual((await servers[0].snapshot()).focused_pane_id,servers[0].shell.pane_id);return replaced;
    }};
   }
   return updatePrism({root:source,herdrBin:herdr,session:servers[0].name,env:servers[0].env,transaction,configDir:installed.configDir,stateDir:installed.stateDir,configPath});
  };
  await stage('isolatedTwoServerBaseline',async()=>{
   await servers[0].rpc.call('agent.focus',{target:servers[0].natives[2].pane_id});
   const plugin=await servers[1].view(servers[1].natives[0]);await servers[1].rpc.call('plugin.pane.focus',{pane_id:plugin.pane_id});
   const before=await capture();assert.equal(before.shortcut.enabled,false);assert.equal(before.settings.nativeMode,'inspector-only');
   for(const saved of before.servers){assert.equal(saved.views.length,3);assert.equal(saved.views.filter(view=>view.open).length,2);}
   return{namedServers:servers.map(own=>own.name),openViews:4,closedViews:2,privateNotebooks:6,ordinaryShellPanes:1,ordinaryShellAbsentFromAgents:true,distinctPerTargetWidths:true,shortcutOptOut:true,focusKinds:before.servers.map(saved=>saved.focus.type),allManifestCommandsBoundTo:process.execPath};
  });
  await stage('updateFlushesEditorDraftAndRetainsState',async()=>{
   const own=servers[0],native=own.natives[0],panel=await own.view(native);
   await own.cli(['pane','send-text',panel.pane_id,'\r']);await until('actual Notes editor active',async()=>(await own.text(panel.pane_id)).includes('Editing'));
   const note=(await own.noteStore.load(native.key)),external='SYNTHETIC external authoritative notebook\n';await writeFile(note.path,external,{mode:0o600});own.notes.set(native.key,external);
   await own.cli(['pane','send-text',panel.pane_id,'\x1b[200~SYNTHETIC unsaved update draft\x1b[201~']);
   const before=await capture();await update(newRelease);await verify(before);
   assert.equal(JSON.parse(await readFile(path.join(installed.managedDir,'dist/update-fixture.json'),'utf8')).revision,'new');
   const files=(await readdir(path.dirname(note.path))).filter(name=>/^recovery-.*\.md$/.test(name));assert.equal(files.length,1);
   const draft=await readFile(path.join(path.dirname(note.path),files[0]),'utf8');assert.ok(draft.includes('SYNTHETIC unsaved update draft'));
   own.recovery={path:path.join(path.dirname(note.path),files[0]),bytes:Buffer.byteLength(draft),sha256:digest(draft)};
   return{realCodeReplacement:true,editorDraftRecovered:true,externalNotePreserved:true,draft:{bytes:own.recovery.bytes,sha256:own.recovery.sha256},privateNotesRetained:true,restoredOwnerHeaders:true,visibleNotesReadback:true,exactPreferencesAndWidths:true,openAndClosedViewsRetained:true,nativeAndPluginFocusRestored:true,serversNotRestarted:true};
  });
  await stage('repeatedUpdatePreservesNativeMode',async()=>{
   for(const own of servers)await own.action('activate-overview');
   await servers[0].rpc.call('agent.focus',{target:servers[0].natives[2].pane_id});
   await servers[1].rpc.call('plugin.pane.focus',{pane_id:(await servers[1].view(servers[1].natives[0])).pane_id});
   const before=await capture();assert.equal(before.settings.nativeMode,'overview');assert.ok(!before.configText.includes('key = "prefix+i"'));
   await update(newRelease);await verify(before);
   assert.equal(digest(await readFile(servers[0].recovery.path)),servers[0].recovery.sha256);
   return{secondUpdate:true,nativeModeRetained:true,shortcutOptOutRetained:true,recoveryBytesRetained:true,exactStateRetained:true};
  });
  await stage('ordinaryShellFocusRestoredAfterReplacement',async()=>{
   const own=servers[0];assert.ok(!(await own.snapshot()).agents.some(agent=>agent.terminal_id===own.shell.terminal_id));
   await own.rpc.call('pane.focus',{pane_id:own.shell.pane_id});assert.equal((await own.snapshot()).focused_pane_id,own.shell.pane_id);
   const before=await capture();assert.equal(before.servers[0].focus.terminalId,own.shell.terminal_id);
   await update(newRelease,{moveShellFocusAfterReplace:true});await verify(before);
   assert.equal((await own.snapshot()).focused_pane_id,own.shell.pane_id);
   assert.ok(!(await own.snapshot()).agents.some(agent=>agent.terminal_id===own.shell.terminal_id));
   return{ordinaryShellNotAnAgent:true,focusChangedAfterActualReplacement:true,exactShellPaneAndTerminalRestored:true,allExistingViewsNotesPreferencesAndWidthsRetained:true};
  });
  await stage('activationFailureRollsBackOldCodeAndState',async()=>{
   const before=await capture(),manifest=digest(await readFile(path.join(installed.managedDir,'herdr-plugin.toml')));
   await assert.rejects(update(badRelease),error=>{
    assert.match(error.message,/original code and panel state restored/,'failure must prove complete rollback');
    assert.equal(error.cause?.cause?.code,81,'the injected activation entrypoint caused the failure');return true;
   });await verify(before);
   assert.equal(digest(await readFile(path.join(installed.managedDir,'herdr-plugin.toml'))),manifest);
   assert.equal(JSON.parse(await readFile(path.join(installed.managedDir,'dist/update-fixture.json'),'utf8')).revision,'new');
   assert.equal((await servers[0].cli(['plugin','list','--plugin',pluginId,'--json'])).plugins[0].enabled,true);
   return{actualActivationExit:81,previousCodeRestored:true,enabledStateRestored:true,allViewsNotesPreferencesWidthsAndFocusRestored:true};
  });
  await stage('platformInstallerRerunPreservesBothServers',async()=>{
   const before=await capture(),installerEnv={...servers[0].env};
   assert.equal(before.servers[0].focus.terminalId,servers[0].shell.terminal_id,'installer rerun starts with an ordinary shell focused');
   let herdrDirectory=path.dirname(herdr);
   if(process.platform==='win32'&&path.basename(herdr).toLowerCase()!=='herdr.exe'){
    // CI's pinned asset has a release-specific filename. Give PowerShell the
    // ordinary installation name without changing or replacing that asset.
    herdrDirectory=path.join(directory,'prerequisites');await mkdir(herdrDirectory,{mode:0o700});
    const executable=path.join(herdrDirectory,'herdr.exe');await copyFile(herdr,executable);
    assert.equal(digest(await readFile(executable)),digest(await readFile(herdr)),'owned herdr.exe is the exact verified prerequisite');
   }
   const originalPath=Object.entries(installerEnv).find(([key])=>key.toUpperCase()==='PATH')?.[1]??'';
   for(const key of Object.keys(installerEnv))if(key.toUpperCase()==='PATH')delete installerEnv[key];
   installerEnv.PATH=[herdrDirectory,path.dirname(process.execPath),originalPath].join(path.delimiter);
   const binary=process.platform==='win32'?'powershell.exe':'/bin/sh';
   const args=process.platform==='win32'
    ?['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(newRelease,'scripts/install-windows.ps1'),'-SourceDir',newRelease,'-Session',servers[0].name]
    :[path.join(newRelease,'install.sh'),'--source-dir',newRelease,'--herdr-bin',herdr,'--node-bin',process.execPath,'--session',servers[0].name,'--no-start'];
   const output=await exec(binary,args,{env:installerEnv,cwd:directory,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:4*1024*1024});
   assert.match(output.stdout,/updated to/i,'the actual installer took its update branch');await verify(before);
   assert.equal(digest(await readFile(servers[0].recovery.path)),servers[0].recovery.sha256);
   return{entrypoint:process.platform==='win32'?'scripts/install-windows.ps1':'install.sh',actualInstallerUpdateBranch:true,noDownloadsOrSourceBuild:true,bothNamedServersRestored:true,ordinaryShellFocusRetained:true,exactNotesPreferencesWidthsAndFocusRetained:true};
  });
  await stage('githubSourceMetadataCliAndRpcUpdate',async()=>{
   const original=await capture(),firstRevision='a'.repeat(40),nextRevision='b'.repeat(40);
   const source={kind:'github',owner:'alexiob',repo:'herdr-prism',managed_path:installed.managedDir,requested_ref:'synthetic',resolved_commit:firstRevision,installed_unix_ms:1};
   githubMetadata=true;
   try{
    for(const own of servers){
     await own.rpc.call('plugin.link',{path:installed.managedDir,enabled:true,source});
     const cliInfo=(await own.cli(['plugin','list','--plugin',pluginId,'--json'])).plugins[0];
     const rawInfo=(await own.rpc.call('plugin.list',{plugin_id:pluginId})).plugins[0];
     assert.deepEqual(cliInfo.source,rawInfo.source,'CLI and raw RPC return the same GitHub source facts');
     assert.notEqual(JSON.stringify(cliInfo.source),JSON.stringify(rawInfo.source),'the fixture exercises actual CLI/RPC source property-order differences');
     assert.equal(cliInfo.source.kind,'github');assert.equal(cliInfo.source.resolved_commit,firstRevision);
     assert.equal((await own.store.read('controller')).pid,original.servers.find(saved=>saved.own===own).controller.pid,'metadata linking preserves the current collector');
    }
    await verify(original,{restarted:false});
    const before=await capture();await update(newRelease,{revision:nextRevision,ref:'synthetic'});await verify(before);
    for(const own of servers){
     const info=(await own.cli(['plugin','list','--plugin',pluginId,'--json'])).plugins[0];
     assert.equal(info.source.kind,'github');assert.equal(info.source.resolved_commit,nextRevision);assert.equal(info.source.requested_ref,'synthetic');assert.equal(info.source.managed_path,installed.managedDir);
    }
   }finally{
    // GitHub source here is fixture metadata only. Restore local ownership
    // before any native uninstall can interpret managed_path as removable code.
    const restored=await capture();
    for(const own of servers){
     await own.rpc.call('plugin.link',{path:installed.managedDir,enabled:true,source:{kind:'local'}});
     assert.equal((await own.cli(['plugin','list','--plugin',pluginId,'--json'])).plugins[0].source.kind,'local');
     assert.equal((await own.store.read('controller')).pid,restored.servers.find(saved=>saved.own===own).controller.pid,'restoring local metadata does not restart the collector');
    }
    githubMetadata=false;await verify(restored,{restarted:false});
   }
   return{actualCliAndRawRpc:true,equalSourceWithDifferentSerializedKeyOrder:true,githubRevisionReplaced:true,twoServerRevisionPropagation:true,localMetadataRestoredWithoutRestart:true,noNetworkOrClone:true,notesWidthsPreferencesAndFocusRetained:true};
  });
  await stage('disabledUpdateStaysDisabled',async()=>{
   await servers[0].action('deactivate');await servers[0].cli(['plugin','disable',pluginId]);
   for(const own of servers){await until('collector deactivated',async()=>!(await own.store.read('controller')));await own.rpc.call('agent.focus',{target:own.natives[2].pane_id});}
   const before=await capture();await update(newRelease);await verify(before,{active:false,restarted:false});
   assert.equal((await servers[0].cli(['plugin','list','--plugin',pluginId,'--json'])).plugins[0].enabled,false);
   for(const own of servers)assert.equal((await own.snapshot()).panes.length,own.natives.length+(own.shell?1:0));
   return{registrationRemainsDisabled:true,noCollectorOrPanelStarted:true,nativeFocusRetained:true,notebooksAndPreferencesRetained:true};
  });
  result.notes=[];
  for(const own of servers)for(const key of own.notes.keys()){
   const note=await own.noteStore.load(key),stat=await lstat(note.path);
   if(process.platform!=='win32')assert.equal(stat.mode&0o077,0,'synthetic Markdown remains private');
   result.notes.push({session:own.name,key,path:path.relative(installed.stateDir,note.path).replaceAll('\\','/'),bytes:stat.size,revision:note.revision});
  }
  // Enable only the fixture registration so its authenticated uninstall action
  // can run; the preceding assertion proves update itself left it disabled.
  await servers[0].cli(['plugin','enable',pluginId]);await liveUninstall(installOptions);installed=undefined;
  assert.equal(await readFile(configPath,'utf8'),original);
  result.ok=true;success=true;await save();return result;
 }catch(error){result.error=error.stack??String(error);result.failure=[];for(const own of servers){try{result.failure.push({session:own.name,snapshot:await own.snapshot(),logs:(await own.cli(['plugin','log','list','--plugin',pluginId,'--limit','32'])).logs});}catch{}}await save();throw error;}
 finally{
  if(installed){try{if(githubMetadata){for(const own of servers)await own.rpc.call('plugin.link',{path:installed.managedDir,enabled:true,source:{kind:'local'}});githubMetadata=false;}await servers[0].cli(['plugin','enable',pluginId]);const {liveUninstall}=await import(pathToFileURL(path.join(installed.managedDir,'scripts/live-install.mjs')).href);await liveUninstall(installOptions);}catch(error){result.cleanupError=String(error);await save();}}
  for(const own of servers){try{if(own.server.exitCode===null)await own.cli(['server','stop']);}catch{if(own.server.exitCode===null)own.server.kill();}
   if(own.server.exitCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>{own.server.kill();resolve();},5000);own.server.once('exit',()=>{clearTimeout(timer);resolve();});});
   own.rpc.close();await own.log.close();
  }
  if(success){assert.equal(path.dirname(directory),path.resolve(process.platform==='win32'?os.tmpdir():'/tmp'));await rm(directory,{recursive:true,force:true});}
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let index=2;index<process.argv.length;index++){const arg=process.argv[index];if(!['--release','--herdr','--proof'].includes(arg)||!process.argv[index+1])throw Error('Use --release ROOT [--herdr BIN] [--proof DIR]');options[arg.slice(2)]=process.argv[++index];}
 try{console.log(JSON.stringify(await liveUpdateTest(options),null,2));}catch(error){console.error(error.stack??String(error));process.exitCode=1;}
}
