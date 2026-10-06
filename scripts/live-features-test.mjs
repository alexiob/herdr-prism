import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,appendFile,open,lstat,rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const exec=promisify(execFile);
const project=fileURLToPath(new URL('..',import.meta.url));
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
async function until(label,probe,timeoutMs=12000){const deadline=Date.now()+timeoutMs;let last;while(Date.now()<deadline){try{const value=await probe();if(value)return value;}catch(error){last=error;}await delay(100);}throw new Error(`${label} timed out${last?': '+last.message:''}`);}

/** Actual isolated Herdr acceptance with explicitly synthetic provider records.
 * All control targets this harness's named server, XDG roots and returned IDs.
 * No provider command, network request, paid model or user configuration is used.
 */
export async function liveFeaturesTest({release,herdr=process.env.HERDR_BIN_PATH??'herdr',proof=path.join(project,'artifacts/live-features-proof'),references=false}={}){
 if(!release)throw new Error('--release must name a reviewed checksummed release');
 release=path.resolve(release);proof=path.resolve(proof);
 const load=file=>import(pathToFileURL(path.join(release,file)).href);
 const {liveInstall,liveUninstall,pluginId}=await load('scripts/live-install.mjs');
 const {HerdrClient}=await load('dist/herdr/client.js');
 const {StateStore,identityName}=await load('dist/state/store.js');
 const {Collector}=await load('dist/runtime/collector.js');
 const {NativePublisher}=await load('dist/native/publisher.js');
 const directory=await mkdtemp(path.join(process.platform==='win32'?os.tmpdir():'/tmp','hpf-'));
 await mkdir(proof,{recursive:true});
 const name='features',configHome=path.join(directory,'c'),configPath=path.join(configHome,'herdr','config.toml');
 const providerHomes={codex:path.join(directory,'provider-codex'),claude:path.join(directory,'provider-claude'),pi:path.join(directory,'provider-pi')};
 for(const dir of [path.dirname(configPath),...Object.values(providerHomes)])await mkdir(dir,{recursive:true,mode:0o700});
 const original='[server]\nheadless_cols = 160\nheadless_rows = 50\n[ui.sidebar.agents]\nrows = [["agent", "workspace", "tab"]]\n';
 await writeFile(configPath,original,{mode:0o600});
 // This location is Herdr's documented dedicated plugin config namespace. Cleanup
 // uses only the authenticated directory paths returned by the managed wrapper.
 const settingsDir=path.join(configHome,'herdr','plugins','config',pluginId);
 await mkdir(settingsDir,{recursive:true,mode:0o700});
 const settings={nativeMode:'overview',providerHomes,todosEnabled:false,sampleIntervalMs:2000,follow:true,ascii:false,monochrome:false};
 await writeFile(path.join(settingsDir,'settings.json'),JSON.stringify(settings),{mode:0o600});
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('HERDR_'))delete env[key];
 Object.assign(env,{XDG_CONFIG_HOME:configHome,XDG_STATE_HOME:path.join(directory,'s'),XDG_DATA_HOME:path.join(directory,'d'),HERDR_CONFIG_PATH:configPath,TERM:'xterm-256color',PI_CODING_AGENT_DIR:providerHomes.pi,CLAUDE_CONFIG_DIR:providerHomes.claude,CODEX_HOME:providerHomes.codex});
 if(process.platform==='win32'){env.APPDATA=configHome;env.LOCALAPPDATA=path.join(directory,'local');}else env.SHELL='/bin/sh';
 const endpoint=path.join(configHome,'herdr','sessions',name,'herdr.sock');
 const handle=await open(path.join(proof,'server.log'),'w',0o600);
 const server=spawn(herdr,['--session',name,'server'],{cwd:directory,env,stdio:['ignore',handle.fd,handle.fd],windowsHide:true});let serverError;server.on('error',error=>{serverError=error;});
 const rpc=new HerdrClient(endpoint,{timeoutMs:3000});
 const managedDir=path.join(directory,'managed');
 const options={root:release,managedDir,herdrBin:herdr,herdrPrefix:['--session',name],env:{...env,HERDR_SOCKET_PATH:endpoint},timeoutMs:30000};
 const cli=async args=>{const output=await exec(herdr,['--session',name,...args],{env:options.env,cwd:directory,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:4*1024*1024});return output.stdout.trim()?JSON.parse(output.stdout).result:{};};
 const snapshot=async()=>(await rpc.call('session.snapshot')).snapshot;
 const pane=async id=>(await rpc.call('pane.get',{pane_id:id})).pane;
 const text=async id=>(await exec(herdr,['--session',name,'pane','read',id,'--source','visible','--lines','60'],{env:options.env,cwd:directory,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:4*1024*1024})).stdout;
 const source=`plugin:${pluginId}`;
 const evidence={kind:'actual-isolated-herdr-features',ok:false,pluginId,platform:process.platform,arch:process.arch,node:process.version,release,directory,fixtureNotice:'Synthetic Pi-shaped version-3 records and idle Node fixtures with explicit process.title=pi; no paid provider or provider-version compatibility claim.',checks:{},limits:['Headless server and actual terminal readback; native sidebar pixels and multi-client renderer differences are not certified.','Hidden transcript/body pause and stale resource publication are observed; zero internal Git/process reads are not directly instrumented.']};
 const save=async()=>writeFile(path.join(proof,'features.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 const stage=async(label,run)=>{console.log(JSON.stringify({stage:label,status:'running'}));const value=await run();evidence.checks[label]=value;await save();console.log(JSON.stringify({stage:label,status:'passed'}));return value;};
 let installed,store,controller,pausedPid,probeCollector,success=false;
 try{
  await stage('isolatedServer',async()=>{await until('dedicated server startup',async()=>{if(serverError)throw serverError;if(server.exitCode!==null)throw new Error('Dedicated server exited '+server.exitCode);return snapshot();});return{version:(await exec(herdr,['--version'],{env,encoding:'utf8'})).stdout.trim(),endpoint};});
  // Herdr0.9.3 uses Linux comm before unwrapping generic runtimes. Node24 names its
  // main thread MainThread, so a script basename alone is not a portable identity.
  // Name only this explicitly synthetic child; detection still observes the real process.
  const fixtureCli=path.join(directory,'fixtures','pi');await mkdir(path.dirname(fixtureCli),{recursive:true});await writeFile(fixtureCli,"process.title='pi';console.log('SYNTHETIC FIXTURE ONLY; no model');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));setInterval(()=>{},1000);\n");
  const fixtureDirectory=path.join(providerHomes.pi,'sessions','fixture-project');await mkdir(fixtureDirectory,{recursive:true});
  const fixture=async id=>{const file=path.join(fixtureDirectory,id+'.jsonl');await writeFile(file,[{type:'session',version:3,id,cwd:directory,timestamp:new Date().toISOString()},{type:'session_info',id:'info',name:id},{type:'message',id:id+'-first',timestamp:new Date().toISOString(),message:{role:'assistant',content:[{type:'text',text:'SYNTHETIC '+id+' FIRST MESSAGE'}],stopReason:'stop'}}].map(row=>JSON.stringify(row)+'\n').join(''));return file;};
  const alphaFile=await fixture('fixture-alpha'),betaFile=await fixture('fixture-beta');
  const created=await cli(['workspace','create','--cwd',directory,'--label','Synthetic feature fixtures','--focus']);
  const alpha=created.root_pane,beta=(await cli(['tab','create','--workspace',created.workspace.workspace_id,'--cwd',directory,'--label','Fixture beta','--no-focus'])).root_pane;
  const report=async(target,file,seq)=>{await rpc.call('pane.report_agent',{pane_id:target.pane_id,source:'herdr:pi',agent:'pi',state:'working',agent_session_path:file,seq});await rpc.call('pane.report_agent_session',{pane_id:target.pane_id,source:'herdr:pi',agent:'pi',agent_session_path:file,session_start_source:'startup',seq:seq+1});};
  await stage('explicitFixtureSessions',async()=>{for(const[target,file,label]of [[alpha,alphaFile,'fixture-alpha'],[beta,betaFile,'fixture-beta']]){const command=process.platform==='win32'?`& ${"'"+process.execPath.replaceAll("'","''")+"'"} ${"'"+fixtureCli.replaceAll("'","''")+"'"} --session ${"'"+file.replaceAll("'","''")+"'"}`:`exec ${quote(process.execPath)} ${quote(fixtureCli)} --session ${quote(file)}`;await cli(['pane','run',target.pane_id,command]);await until('idle fixture detected as pi',async()=>{const agent=(await snapshot()).agents.find(a=>a.terminal_id===target.terminal_id);return agent?.agent==='pi'&&agent;});await report(target,file,100);await until('dedicated session report attached',async()=>{const agent=(await snapshot()).agents.find(a=>a.terminal_id===target.terminal_id);return agent?.agent_session?.kind==='path'&&agent.agent_session.value===file&&agent;});await cli(['agent','rename',target.pane_id,label]);}return{alpha:{paneId:alpha.pane_id,terminalId:alpha.terminal_id,session:alphaFile},beta:{paneId:beta.pane_id,terminalId:beta.terminal_id,session:betaFile},reportMethods:['pane.report_agent','pane.report_agent_session']};});
  await rpc.call('agent.focus',{target:alpha.pane_id});
  installed=await liveInstall(options);store=new StateStore(path.join(installed.stateDir,'servers',identityName(endpoint)));controller=await store.read('controller');assert.ok(controller?.terminalId&&controller.pid);assert.equal(installed.configDir,settingsDir,'fixture-only provider homes are loaded from exact Herdr namespace');
  const ownPane=async()=>{const current=await snapshot();return current.panes.find(p=>p.terminal_id===controller.terminalId);};
  let nativePrefix;
  await stage('nativeMetadataReadback',async()=>{const value=await until('native fixture publication',async()=>{const p=await pane(alpha.pane_id);const line=Object.keys(p.tokens??{}).find(k=>/^(hat|prism)_line$/.test(k));if(!line)return;nativePrefix=line.slice(0,-5);return p.tokens[line].includes('fixture-alpha')&&p.tokens[nativePrefix+'_last']?.includes('FIRST MESSAGE')&&p;});const keys=Object.keys(value.tokens).filter(k=>k.startsWith(nativePrefix+'_'));assert.ok(keys.length<=14);for(const key of ['line','goal','load','counts','branch','div','last','rank'])assert.equal(typeof value.tokens[nativePrefix+'_'+key],'string');assert.equal((await snapshot()).focused_pane_id,alpha.pane_id);return{tokenPrefix:nativePrefix,nonemptyKeys:keys,emptyTokensOmittedByHerdr:true,budgetAtMost14:true,focusedFixturePreserved:true};});
  const token=name=>nativePrefix+'_'+name;
  const rightOf=async target=>{const current=await snapshot(),panel=current.panes.find(p=>p.terminal_id===controller.terminalId);if(panel?.tab_id!==target.tab_id)return;const layout=current.layouts.find(l=>l.tab_id===target.tab_id),agentRect=layout?.panes.find(p=>p.pane_id===target.pane_id)?.rect,panelRect=layout?.panes.find(p=>p.pane_id===panel.pane_id)?.rect;return agentRect&&panelRect&&panelRect.x>=agentRect.x+agentRect.width&&panel;};
  await stage('rightFollowAndPin',async()=>{await until('initial right placement',()=>rightOf(alpha));await rpc.call('agent.focus',{target:beta.pane_id});await until('right follow to beta',()=>rightOf(beta));let panel=await ownPane();await until('followed beta reader',async()=>(await text(panel.pane_id)).includes('fixture-beta'));await cli(['pane','send-text',panel.pane_id,'p']);await until('pin keyboard applied',async()=>(await text(panel.pane_id)).includes('[pin]'));await rpc.call('agent.focus',{target:alpha.pane_id});await delay(1800);panel=await ownPane();assert.equal(panel.tab_id,beta.tab_id);assert.ok((await text(panel.pane_id)).includes('fixture-beta'));return{rightPlacement:true,followAcrossTabs:true,pinRetainsBetaPaneAndReader:true,terminalStable:panel.terminal_id===controller.terminalId};});
  await stage('hiddenPauseAndResume',async()=>{const before=await pane(beta.pane_id);await appendFile(betaFile,JSON.stringify({type:'message',id:'hidden-message',timestamp:new Date().toISOString(),message:{role:'assistant',content:[{type:'text',text:'SYNTHETIC HIDDEN MESSAGE'}],stopReason:'stop'}})+'\n');await delay(3200);const hidden=await pane(beta.pane_id);assert.equal(hidden.tokens[token('last')],before.tokens[token('last')]);assert.equal(hidden.tokens[token('fresh')],'stale');await cli(['tab','focus',beta.tab_id]);await until('visible fixture body resumes',async()=>(await pane(beta.pane_id)).tokens?.[token('last')]?.includes('HIDDEN MESSAGE'));return{newBodyNotHydratedWhileHidden:true,resourcesLabeledStale:true,bodyHydratedAfterVisible:true};});
  if(references)await stage('referenceHistoryNavigation',async()=>{
   const base=Date.now()-100000,record=(id,body,at)=>({type:'message',id,timestamp:new Date(at).toISOString(),message:{role:'assistant',content:[{type:'text',text:body}],stopReason:'stop'}});
   await mkdir(path.join(directory,'src'),{recursive:true});await writeFile(path.join(directory,'src','shared.ts'),'SYNTHETIC REFERENCE FIXTURE\n');
   const rows=[...Array.from({length:150},(_,i)=>record('beta-mention-'+i,'SYNTHETIC MENTION '+i+' of `src/shared.ts`',base+i)),{type:'message',id:'beta-write-call',timestamp:new Date(base+151).toISOString(),message:{role:'assistant',content:[{type:'toolCall',id:'write-shared',name:'write',arguments:{path:'src/shared.ts'}}],stopReason:'toolUse'}},{type:'message',id:'beta-write-result',timestamp:new Date(base+152).toISOString(),message:{role:'toolResult',toolCallId:'write-shared',content:[{type:'text',text:'Success'}]}},...Array.from({length:2105},(_,i)=>record('beta-ref-'+i,'See `src/ref-'+i+'.ts`',base+200+i))];
   await appendFile(betaFile,rows.map(row=>JSON.stringify(row)+'\n').join(''));await until('bounded historical reference publication',async()=>/r2000\+/.test((await pane(beta.pane_id)).tokens?.[token('counts')]??''));
   const panel=await ownPane(),send=value=>cli(['pane','send-text',panel.pane_id,value]),screen=()=>text(panel.pane_id);await send('\t\t\t\t');await until('Refs tab selected',async()=>/\[Refs\]|< Refs >/.test(await screen()));
   for(const count of [50,100,106]){await send('b');await until('older target page '+count,async()=>new RegExp(count+' loaded').test(await screen()));}
   await send('Gk');await until('recovered target shows explicit successful edit evidence',async()=>/✎[^\n]*shared\.ts/.test(await screen()));await send(' ');await until('source history opened for the oldest recovered target',async()=>{const value=await screen();return value.includes('shared.ts')&&value.includes('50 mention sources');});
   for(const count of [100,150]){await send('b');await until('older source page '+count,async()=>(await screen()).includes(count+' mention sources'));}
   await send('Gk\r');await until('exact first mention source opened',async()=>(await screen()).includes('SYNTHETIC MENTION 0 of'));await send('\x1b');await until('return to source reader anchor',async()=>{const value=await screen();return value.includes('beta-mention-0')&&value.includes('End of mention history');});await send('\x1b');await until('return to older reference target anchor',async()=>{const value=await screen();return value.includes('shared.ts')&&value.includes('End of target history');});
   await send('\t\t');await until('Overview restored after reference fixture',async()=>/\[Overview\]|< Overview >/.test(await screen()));
   return{targetsInFixture:2106,hotTargets:2000,olderTargetsRecovered:106,mentionsRecovered:150,exactFirstSourceOpened:true,sourceAndTargetAnchorsRestored:true,actualInspectorKeyboardAndHerdrPTY:true,explicitSuccessfulEditFixture:true};
  });
  await stage('nativeMetadataExpiry',async()=>{if(process.platform==='win32'){
    // Stop the owned periodic publisher gracefully, then publish once through the
    // actual production publisher. This measures host expiry without suspension,
    // fake clocks, clearing the tested keys, or periodic renewal during the wait.
    const oldPid=controller.pid,panel=await ownPane();await cli(['pane','send-text',panel.pane_id,'q']);
    await until('owned publisher stopped for TTL fixture',async()=>{if(await store.read('controller'))return false;try{process.kill(oldPid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}});
    probeCollector=new Collector({rpc,settings:{...settings,nativeMode:'inspector-only'},stateDir:path.join(directory,'ttl-probe'),paneOpen:false});await probeCollector.init();await probeCollector.refresh();
    const fixtureSession=probeCollector.data.sessions.find(s=>s.attachment?.terminal_id===beta.terminal_id);assert.ok(fixtureSession);
    await probeCollector.close({clearNative:false});probeCollector=undefined;
    await rpc.call('pane.report_metadata',{pane_id:beta.pane_id,source:'fixture.prism.ttl',tokens:{fixture_foreign:'preserve'},ttl_ms:60000,seq:1});
    const publisher=new NativePublisher(rpc);await publisher.publish([fixtureSession]);assert.equal(publisher.diagnostics.length,0);assert.equal(publisher.ownership().length,1);
    const published=await pane(beta.pane_id);assert.ok(published.tokens?.[token('line')]);const started=Date.now();
    const expired=await until('production publisher metadata TTL expiry',async()=>{const p=await pane(beta.pane_id);return Object.keys(p.tokens??{}).every(k=>!k.startsWith(nativePrefix+'_'))&&p;},22000);
    assert.equal(expired.agent,'pi');assert.ok(expired.workspace_id&&expired.tab_id&&expired.agent_session);assert.equal(expired.tokens.fixture_foreign,'preserve');
    const elapsedMs=Date.now()-started;const action=(await cli(['plugin','action','invoke','activate-overview','--plugin',pluginId])).log;
    await until('publisher restart after TTL fixture',async()=>{const entry=(await cli(['plugin','log','list','--plugin',pluginId,'--limit','64'])).logs.find(l=>l.log_id===action.log_id);if(entry?.status==='failed')throw Error(entry.stderr||entry.error);return entry?.status==='succeeded'&&entry.exit_code===0;},30000);
    controller=await store.read('controller');await until('native metadata renewed after TTL fixture',async()=>(await pane(beta.pane_id)).tokens?.[token('line')]);
    return{expiredAfterMs:elapsedMs,allPublishedNativeTokensExpired:true,builtinAgentWorkspaceTabFactsRetained:true,foreignMetadataRetained:true,resumed:true,method:'graceful owned publisher stop, one production NativePublisher write, actual host clock expiry, explicit restart'};
   }await rpc.call('pane.report_metadata',{pane_id:beta.pane_id,source:'fixture.prism.ttl',tokens:{fixture_foreign:'preserve'},ttl_ms:60000,seq:1});pausedPid=controller.pid;process.kill(pausedPid,'SIGSTOP');const started=Date.now();const expired=await until('15-second native metadata TTL expiry',async()=>{const p=await pane(beta.pane_id);return Object.keys(p.tokens??{}).every(k=>!k.startsWith(nativePrefix+'_'))&&p;},22000);assert.equal(expired.agent,'pi');assert.ok(expired.workspace_id&&expired.tab_id&&expired.agent_session);assert.equal(expired.tokens.fixture_foreign,'preserve');process.kill(pausedPid,'SIGCONT');pausedPid=undefined;await until('native metadata resumes after controlled suspension',async()=>(await pane(beta.pane_id)).tokens?.[token('line')]);return{expiredAfterMs:Date.now()-started,allPublishedNativeTokensExpired:true,builtinAgentWorkspaceTabFactsRetained:true,foreignMetadataRetained:true,resumed:true};});
  await stage('staleOccupantGuards',async()=>{probeCollector=new Collector({rpc,settings:{...settings,nativeMode:'inspector-only'},stateDir:path.join(directory,'focus-probe'),paneOpen:false});await probeCollector.init();await probeCollector.refresh();const old=probeCollector.data.sessions.find(s=>s.attachment?.terminal_id===beta.terminal_id);assert.ok(old);const replacement=await fixture('fixture-replacement');await report(beta,replacement,1000);await until('fixture occupant identity replaced',async()=>(await pane(beta.pane_id)).agent_session?.value===replacement);const focused=(await snapshot()).focused_pane_id;await assert.rejects(probeCollector.focus(old.key),/occupant changed|ended/);assert.equal((await snapshot()).focused_pane_id,focused);let writes=0;const observed={call:async(method,params)=>{if(method==='pane.report_metadata')writes++;return rpc.call(method,params);}};const publisher=new NativePublisher(observed);await publisher.publish([old]);assert.equal(writes,0);assert.equal(publisher.ownership().length,0);assert.ok(publisher.diagnostics.some(d=>/occupant changed/.test(d)));await probeCollector.close({clearNative:false});probeCollector=undefined;return{focusRejectedChangedSession:true,focusPreserved:true,publicationRejectedBeforeWrite:true};});
  await stage('closedCollectorStops',async()=>{const panel=await ownPane(),oldPid=controller.pid;await cli(['pane','send-text',panel.pane_id,'q']);await until('foreground collector closes',async()=>!(await store.read('controller')));await until('own collector process gone',async()=>{try{process.kill(oldPid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}});const action=(await cli(['plugin','action','invoke','activate-overview','--plugin',pluginId])).log;await until('replacement action succeeds',async()=>{const entry=(await cli(['plugin','log','list','--plugin',pluginId,'--limit','64'])).logs.find(l=>l.log_id===action.log_id);if(entry?.status==='failed')throw new Error(entry.stderr||entry.error||'Replacement failed');return entry?.status==='succeeded'&&entry.exit_code===0;},30000);controller=await store.read('controller');assert.ok(controller?.pid&&controller.pid!==oldPid);return{closedPidGone:true,noDetachedCollector:true,restartedForRemainingAcceptance:true};});
  await stage('projectionSourceGuardAndCoexistence',async()=>{const wrong=await rpc.call('agent.view.clear',{source:'fixture.prism.wrong-owner'});assert.equal(wrong.active,true);assert.equal(wrong.source,source);await rpc.call('agent.view.set',{source:'fixture.prism.foreign-owner',label:'Synthetic coexistence view',sort:[]});const retained=await rpc.call('agent.view.clear',{source});assert.equal(retained.active,true);assert.equal(retained.source,'fixture.prism.foreign-owner');return{wrongSourceCannotClearPluginView:true,pluginClearPreservesForeignFixtureView:true,fixtureIsNotRadarOrPiTreeCompatibility:true};});
  await stage('configConflictAndRecovery',async()=>{const configured=await readFile(configPath,'utf8');const goalToken='$'+token('goal');assert.ok(configured.includes(goalToken));const extra='\n[fixture_user]\nretained = true\n';await writeFile(configPath,configured.replace(goalToken,'$fixture_user_edit')+extra,{mode:0o600});await assert.rejects(liveUninstall(options),/conflict|User-modified/i);assert.ok((await cli(['plugin','list','--plugin',pluginId,'--json'])).plugins.length);for(const dir of [managedDir,installed.configDir,installed.stateDir])assert.ok((await lstat(dir)).isDirectory());const conflicted=await readFile(configPath,'utf8');assert.ok(conflicted.includes('$fixture_user_edit')&&conflicted.includes('[fixture_user]'));await writeFile(configPath,conflicted.replace('$fixture_user_edit',goalToken),{mode:0o600});const removed=await liveUninstall(options);installed=undefined;assert.equal(removed.removed,true);assert.equal(await readFile(configPath,'utf8'),original+extra);const stillForeign=await rpc.call('agent.view.clear',{source:'fixture.prism.wrong-owner'});assert.equal(stillForeign.source,'fixture.prism.foreign-owner');await rpc.call('agent.view.clear',{source:'fixture.prism.foreign-owner'});return{conflictRefusedPurge:true,registrationAndOwnedDirectoriesRetained:true,userEditPreserved:true,explicitFixtureRecoveryUninstalled:true,originalConfigAndUnrelatedEditRestored:true,foreignProjectionSurvivedUninstall:true};});
  evidence.ok=true;success=true;await save();return evidence;
 }catch(error){evidence.error=error.stack??String(error);try{evidence.failureSnapshot=await snapshot();evidence.failurePaneText=[];for(const p of evidence.failureSnapshot.panes)evidence.failurePaneText.push({paneId:p.pane_id,text:await text(p.pane_id)});evidence.failurePluginLogs=(await cli(['plugin','log','list','--plugin',pluginId,'--limit','32'])).logs;}catch{}await save();throw error;}
 finally{
  if(pausedPid){try{process.kill(pausedPid,'SIGCONT');}catch{}}
  await probeCollector?.close({clearNative:false}).catch(()=>{});
  if(installed){try{await liveUninstall(options);}catch(error){evidence.cleanupError=String(error);await save();}}
  if(!success&&!installed){try{await lstat(path.join(managedDir,'.hat-managed-install.json'));await liveUninstall(options);}catch(error){if(error.code!=='ENOENT'){evidence.cleanupError=String(error);await save();}}}
  try{if(server.exitCode===null)await cli(['server','stop']);}catch{if(server.exitCode===null)server.kill('SIGTERM');}
  if(server.exitCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>{server.kill('SIGKILL');resolve();},5000);server.once('exit',()=>{clearTimeout(timer);resolve();});});
  rpc.close();await handle.close();if(success)await rm(directory,{recursive:true,force:true});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let i=2;i<process.argv.length;i++){const arg=process.argv[i];if(arg==='--references'){options.references=true;continue;}if(!['--release','--herdr','--proof'].includes(arg)||!process.argv[i+1])throw new Error('Use --release ROOT [--herdr BIN] [--proof DIR] [--references]');options[arg.slice(2)]=process.argv[++i];}
 try{console.log(JSON.stringify(await liveFeaturesTest(options),null,2));}catch(error){console.error(error.stack??String(error));process.exitCode=1;}
}
