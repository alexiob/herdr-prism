import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,appendFile,open,lstat,readlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

// Runs only inside this harness's disposable SSH container and named server.
assert.equal(process.platform,'linux');assert.equal(os.userInfo().username,'prism');
const phase=process.argv[2],base='/home/prism/fixture',release='/home/prism/release',name='remote-prism';
const configHome='/home/prism/.config',configPath=configHome+'/herdr/config.toml',endpoint=configHome+'/herdr/sessions/'+name+'/herdr.sock';
const repo=base+'/checkout',session=base+'/pi/sessions/fixture-project/remote-synthetic.jsonl',stateFile=base+'/fixture-state.json';
const original='[server]\nheadless_cols = 150\nheadless_rows = 45\n[ui.sidebar.agents]\nrows = [["agent", "workspace", "tab"]]\n';
const settings={nativeMode:'overview',providerHomes:{pi:base+'/pi',codex:base+'/codex',claude:base+'/claude'},todosEnabled:true,sampleIntervalMs:2000,follow:true,ascii:true,monochrome:true,costRates:{}};
const env={...process.env,XDG_CONFIG_HOME:configHome,XDG_STATE_HOME:'/home/prism/.local/state',XDG_DATA_HOME:'/home/prism/.local/share',HERDR_CONFIG_PATH:configPath,HERDR_SOCKET_PATH:endpoint,TERM:'xterm-256color',SHELL:'/bin/sh',PI_CODING_AGENT_DIR:settings.providerHomes.pi};
const load=file=>import(pathToFileURL(path.join(release,file)).href),exec=promisify(execFile),quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const {HerdrClient}=await load('dist/herdr/client.js'),{StateStore,identityName}=await load('dist/state/store.js'),{liveInstall,liveUninstall,pluginId}=await load('scripts/live-install.mjs');
const rpc=new HerdrClient(endpoint,{timeoutMs:3000});
const cli=async args=>{const result=await exec('herdr',['--session',name,...args],{env,cwd:base,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});return result.stdout.trim()?JSON.parse(result.stdout).result:{};};
const until=async(label,probe,ms=20000)=>{const end=Date.now()+ms;while(Date.now()<end){const value=await probe().catch(()=>undefined);if(value)return value;await delay(150);}throw Error(label+' timed out');};
const save=state=>writeFile(stateFile,JSON.stringify(state),{mode:0o600});
const options={root:release,managedDir:base+'/managed',herdrBin:'herdr',herdrPrefix:['--session',name],env,timeoutMs:30000};
let result;
try{
 if(phase==='prepare'){
  await mkdir(path.dirname(configPath),{recursive:true});await mkdir(repo,{recursive:true});await mkdir(path.dirname(session),{recursive:true});
  await writeFile(configPath,original,{mode:0o600});const settingsDir=configHome+'/herdr/plugins/config/'+pluginId;await mkdir(settingsDir,{recursive:true,mode:0o700});await writeFile(settingsDir+'/settings.json',JSON.stringify(settings),{mode:0o600});
  for(const args of [['init','-b','remote-proof'],['config','user.name','Synthetic Fixture'],['config','user.email','fixture@example.invalid']])await exec('git',args,{cwd:repo});
  await writeFile(repo+'/remote.txt','original\n');await exec('git',['add','.'],{cwd:repo});await exec('git',['commit','-m','synthetic remote baseline'],{cwd:repo});await writeFile(repo+'/remote.txt','changed remotely\n');
  const rows=[{type:'session',version:3,id:'remote-synthetic',cwd:repo,timestamp:new Date().toISOString()},{type:'message',id:'remote-first',timestamp:new Date().toISOString(),message:{role:'assistant',content:[{type:'text',text:'SYNTHETIC REMOTE TRANSCRIPT ONLY\n[source]('+repo+'/remote.txt)\nACTION: Verify remote fixture'}],stopReason:'stop'}}];await writeFile(session,rows.map(row=>JSON.stringify(row)+'\n').join(''));
  await writeFile(base+'/pi-fixture',"import {writeFileSync} from 'node:fs';process.title='pi';console.log('SYNTHETIC REMOTE PROCESS ONLY; no model');let ticks=0;const save=()=>writeFileSync('/home/prism/fixture/heartbeat.json',JSON.stringify({pid:process.pid,ticks:ticks++}));save();setInterval(save,1000);process.stdin.resume();\n");
  const log=await open(base+'/server.log','w');const server=spawn('herdr',['--session',name,'server'],{env,cwd:base,detached:true,stdio:['ignore',log.fd,log.fd]});server.unref();await log.close();await until('remote named server',()=>rpc.call('session.snapshot'));
  const created=await cli(['workspace','create','--cwd',repo,'--label','REMOTE_SYNTHETIC','--focus']),target=created.root_pane;
  await cli(['pane','run',target.pane_id,'exec node '+quote(base+'/pi-fixture')+' --session '+quote(session)]);
  await until('real synthetic pi process detection',async()=>{const s=(await rpc.call('session.snapshot')).snapshot;return s.agents.find(a=>a.terminal_id===target.terminal_id&&a.agent==='pi');});
  await rpc.call('pane.report_agent',{pane_id:target.pane_id,source:'herdr:pi',agent:'pi',state:'working',agent_session_path:session,seq:100});await rpc.call('pane.report_agent_session',{pane_id:target.pane_id,source:'herdr:pi',agent:'pi',agent_session_path:session,session_start_source:'startup',seq:101});await cli(['agent','rename',target.pane_id,'remote-synthetic']);
  await save({target,serverPid:server.pid});result={platform:process.platform,arch:process.arch,node:process.version,hostname:os.hostname(),serverVersion:(await exec('herdr',['--version'])).stdout.trim(),fixtureNotice:'Explicitly synthetic Pi-shaped records and process; no model invocation',prepared:true};
 }else{
  const state=JSON.parse(await readFile(stateFile,'utf8'));
  if(phase==='install'){
   state.installed=await liveInstall(options);await save(state);const logs=(await cli(['plugin','log','list','--plugin',pluginId,'--limit','16'])).logs;const activation=logs.find(log=>log.action_id==='activate-overview'&&log.status==='succeeded');assert.equal(activation?.exit_code,0);result={installed:true,configOnRemoteServer:true,remoteAction:{id:activation.action_id,status:activation.status,exitCode:activation.exit_code}};
  }else if(phase==='append'){
   await appendFile(session,JSON.stringify({type:'message',id:'remote-disconnected',timestamp:new Date().toISOString(),message:{role:'assistant',content:[{type:'text',text:'SYNTHETIC REMOTE APPEND DURING DISCONNECT'}],stopReason:'stop'}})+'\n');result={appendedOnRemote:true};
  }else if(phase==='inspect'){
   const store=new StateStore(path.join(state.installed.stateDir,'servers',identityName(endpoint))),controller=await store.read('controller');assert.ok(controller?.pid&&controller.terminalId);
   const snapshot=(await rpc.call('session.snapshot')).snapshot,panel=snapshot.panes.find(p=>p.terminal_id===controller.terminalId);assert.ok(panel);
   // Exercise the real closed -> exact native attachment selected -> open transition.
   const {Collector}=await load('dist/runtime/collector.js');const collector=new Collector({rpc,settings:{...settings,nativeMode:'inspector-only'},stateDir:base+'/probe-state'});let view;
   try{await collector.init();await collector.refresh();const attached=()=>collector.data.sessions.find(s=>s.attachments?.some(a=>a.terminal_id===state.target.terminal_id)||s.attachment?.terminal_id===state.target.terminal_id);const initial=attached();assert.ok(initial,'authoritative fixture terminal attachment');collector.setVisibleSession(initial.key,true);await collector.refresh();await collector.sampleProcesses();await delay(650);await collector.sampleProcesses();view=collector.data.sessions.find(s=>s.key===collector.displayedSessionKey);assert.ok(view?.attachments?.some(a=>a.terminal_id===state.target.terminal_id)||view?.attachment?.terminal_id===state.target.terminal_id);assert.equal(view.evidence.id,'remote-synthetic');assert.ok(view.evidence.messages.length);assert.equal(view.git.branch,'remote-proof');assert.equal(view.git.added,1);assert.equal(view.git.deleted,1);assert.ok(BigInt(view.resource.memoryBytes)>0n);assert.ok(view.resource.coverage.readable>0);assert.ok(Number.isFinite(view.resource.cpuPercent));assert.equal(view.todoStatus,'reported');assert.equal(view.todoSourceMessageId,'remote-first');assert.ok(view.todos.some(todo=>todo.text==='Verify remote fixture'&&!todo.checked&&todo.messageId==='remote-first'));assert.ok(view.refs.some(r=>r.target===repo+'/remote.txt'&&r.exists===true));}finally{await collector.close({clearNative:false});}
   const heartbeat=JSON.parse(await readFile(base+'/heartbeat.json','utf8'));const inspectorComm=(await readFile('/proc/'+controller.pid+'/comm','utf8')).trim(),fixtureComm=(await readFile('/proc/'+heartbeat.pid+'/comm','utf8')).trim();assert.equal(fixtureComm,'pi');
   const inspectorArgv=(await readFile('/proc/'+controller.pid+'/cmdline','utf8')).split('\0');assert.ok(inspectorArgv.some(v=>v==='dist/entrypoints/inspector.js'||v.endsWith('/dist/entrypoints/inspector.js')));assert.equal(await readlink('/proc/'+controller.pid+'/cwd'),options.managedDir);
   const screen=(await exec('herdr',['--session',name,'pane','read',panel.pane_id,'--source','visible','--lines','60'],{env,encoding:'utf8'})).stdout;assert.match(screen,/\[(?:Overview|Refs)\]|< (?:Overview|Refs) >/);const serverIdentity=await store.read('server-identity');assert.ok(serverIdentity?.id);assert.ok(screen.includes(os.hostname()));
   const native=(await rpc.call('pane.get',{pane_id:state.target.pane_id})).pane;assert.ok(Object.entries(native.tokens??{}).some(([key,value])=>/^(hat|prism)_rank$/.test(key)&&String(value).startsWith(serverIdentity.id+':')));assert.ok(screen.includes('remote-prism'));
   result={hostname:os.hostname(),serverId:serverIdentity.id,platform:process.platform,controllerPid:controller.pid,controllerTerminalId:controller.terminalId,controllerComm:inspectorComm,fixturePid:heartbeat.pid,fixtureTicks:heartbeat.ticks,fixtureComm,procfsVerified:true,messageIds:view.evidence.messages.map(m=>m.id),git:{branch:view.git.branch,added:view.git.added,deleted:view.git.deleted,availability:view.git.availability},resources:{memoryBytes:view.resource.memoryBytes,cpuPercent:view.resource.cpuPercent,cpuCoverage:view.resource.cpuCoverage,availability:view.resource.availability,coverage:view.resource.coverage},todo:{status:view.todoStatus,pending:view.todos.filter(t=>!t.checked).length,sourceMessageId:view.todoSourceMessageId},remoteRefExists:true,prismPaneVisible:true,screenContainsServerHostname:screen.includes(os.hostname()),nativeLast:Object.values(native.tokens??{}).some(v=>String(v).includes('SYNTHETIC REMOTE')),paneCount:snapshot.panes.length};
  }else if(phase==='focus-dashboard'||phase==='verify-host-tab'){
   const store=new StateStore(path.join(state.installed.stateDir,'servers',identityName(endpoint))),controller=await store.read('controller');const snapshot=(await rpc.call('session.snapshot')).snapshot,panel=snapshot.panes.find(p=>p.terminal_id===controller.terminalId);assert.ok(panel);
   if(phase==='focus-dashboard'){await cli(['pane','focus','--direction','right','--pane',state.target.pane_id]);assert.equal((await rpc.call('session.snapshot')).snapshot.focused_pane_id,panel.pane_id);result={ownDashboardFocused:true};}
   else{const screen=(await exec('herdr',['--session',name,'pane','read',panel.pane_id,'--source','visible','--lines','60'],{env,encoding:'utf8'})).stdout;assert.match(screen,/\[Agents\]|< Agents >/);await cli(['pane','send-text',panel.pane_id,'\t\t\t\t\t']);result={actualHostPTYKeyReachedRemotePrism:true,observedTab:'Agents',resetToOverview:true};}
  }else if(phase==='copy'){
   const store=new StateStore(path.join(state.installed.stateDir,'servers',identityName(endpoint))),controller=await store.read('controller');const snapshot=(await rpc.call('session.snapshot')).snapshot,panel=snapshot.panes.find(p=>p.terminal_id===controller.terminalId);assert.ok(panel);
   const processEnvironment=(await readFile('/proc/'+controller.pid+'/environ','utf8')).split('\0');const stdoutTTY=(await readlink('/proc/'+controller.pid+'/fd/1')).startsWith('/dev/pts/');
   const screenFacts=async()=>{const screen=(await exec('herdr',['--session',name,'pane','read',panel.pane_id,'--source','visible','--lines','60','--format','ansi'],{env,encoding:'utf8'})).stdout;return{refsTab:/\[Refs\]|< Refs >/.test(screen),remoteRefVisible:screen.includes(repo+'/remote.txt'),copyRequested:screen.includes('Copy requested'),clipboardUnavailable:screen.includes('Clipboard unavailable')};};
   await cli(['pane','focus','--direction','right','--pane',state.target.pane_id]);assert.equal((await rpc.call('session.snapshot')).snapshot.focused_pane_id,panel.pane_id);
   await cli(['pane','send-text',panel.pane_id,'\t\t\t\t']);await delay(700);const afterTabs=await screenFacts();assert.ok(afterTabs.refsTab);assert.ok(afterTabs.remoteRefVisible);
   await cli(['pane','send-text',panel.pane_id,'\x1b[B']);await delay(250);const afterDown=await screenFacts();
   await cli(['pane','send-text',panel.pane_id,'y']);await delay(350);const afterCopy=await screenFacts();assert.ok(afterCopy.copyRequested);
   await cli(['pane','send-text',panel.pane_id,'\t\t']);
   result={copyRequestedFromRemoteRefs:true,originPaneFocused:true,herdrEnvPresent:processEnvironment.some(v=>v.startsWith('HERDR_ENV=')),herdrEnvIs1:processEnvironment.includes('HERDR_ENV=1'),stdoutTTY,afterTabs,afterDown,afterCopy};
  }else if(phase==='uninstall'){
   const store=new StateStore(path.join(state.installed.stateDir,'servers',identityName(endpoint))),controller=await store.read('controller');const removed=await liveUninstall(options);assert.equal(removed.removed,true);assert.equal(await readFile(configPath,'utf8'),original);assert.equal((await cli(['plugin','list','--plugin',pluginId,'--json'])).plugins.length,0);for(const dir of [options.managedDir,state.installed.configDir,state.installed.stateDir])await assert.rejects(lstat(dir),e=>e.code==='ENOENT');assert.throws(()=>process.kill(controller.pid,0),e=>e.code==='ESRCH');const final=(await rpc.call('session.snapshot')).snapshot;assert.ok(final.panes.some(p=>p.terminal_id===state.target.terminal_id));result={uninstalled:true,remoteConfigRestored:true,registryRemoved:true,ownedDirectoriesRemoved:true,controllerStopped:true,syntheticRemoteWorkPreserved:true};await cli(['server','stop']);
  }else throw Error('Unknown remote fixture phase');
 }
 console.log(JSON.stringify(result));
}finally{rpc.close();}
