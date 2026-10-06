import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,open,lstat,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {liveInstall,liveUninstall} from './live-install.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const exec=promisify(execFile);
/** Runs only its own server, configuration, fixture workspace and managed copy. */
export async function liveHerdrTest({release,herdr=process.env.HERDR_BIN_PATH??'herdr',proof=path.join(root,'artifacts/live-herdr-proof')}={}){
 if(!release)throw Error('--release must name a checksummed platform release');
 const {HerdrClient}=await import(pathToFileURL(path.join(root,'dist/herdr/client.js')).href);
 const {StateStore,identityName}=await import(pathToFileURL(path.join(root,'dist/state/store.js')).href);
 // Short Unix paths are necessary: macOS sockaddr_un is bounded to104bytes.
 const directory=await mkdtemp(path.join(process.platform==='win32'?os.tmpdir():'/tmp','hat-live-'));
 await mkdir(proof,{recursive:true});
 const name='acceptance',configHome=path.join(directory,'config'),configPath=path.join(configHome,'herdr','config.toml');
 const original='[server]\nheadless_cols = 140\nheadless_rows = 45\n';
 await mkdir(path.dirname(configPath),{recursive:true});await writeFile(configPath,original,{mode:0o600});
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('HERDR_'))delete env[key];
 Object.assign(env,{XDG_CONFIG_HOME:configHome,XDG_STATE_HOME:path.join(directory,'state'),XDG_DATA_HOME:path.join(directory,'data'),HERDR_CONFIG_PATH:configPath,TERM:'xterm-256color'});
 if(process.platform!=='win32')env.SHELL='/bin/sh';
 const endpoint=path.join(configHome,'herdr','sessions',name,'herdr.sock');
 const handle=await open(path.join(proof,'server.log'),'w',0o600);
 const server=spawn(herdr,['--session',name,'server'],{cwd:directory,env,stdio:['ignore',handle.fd,handle.fd],windowsHide:true});
 let serverError;server.on('error',error=>{serverError=error;});
 const rpc=new HerdrClient(endpoint,{timeoutMs:1000});let installed;const managedDir=path.join(directory,'managed');
 const options={root:path.resolve(release),managedDir,herdrBin:herdr,herdrPrefix:['--session',name],env:{...env,HERDR_SOCKET_PATH:endpoint},timeoutMs:30000};
 const cli=async args=>JSON.parse((await exec(herdr,['--session',name,...args],{env:options.env,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:2*1024*1024})).stdout).result;
 const waitAction=async log=>{for(let i=0;i<150;i++){const entry=(await cli(['plugin','log','list','--plugin','iob.herdr-prism','--limit','64'])).logs.find(item=>item.log_id===log.log_id);if(entry?.status==='failed')throw Error(entry.stderr||entry.error||'Lifecycle action failed');if(entry?.status==='succeeded'){assert.equal(entry.exit_code,0);return;}await delay(100);}throw Error('Lifecycle action completion timed out');};
 // Windows recycles numeric PIDs quickly. Retain exact native birth identities
 // so post-removal acceptance cannot mistake another process for our collector.
 let sampler;const births=new Map();
 const captureBirth=async pid=>{if(!sampler)return;const batch=await sampler.sample(),record=batch.processes.find(p=>p.pid===pid);assert.ok(record&&record.startTime!=='0'&&record.availability!=='unavailable','owned collector has a readable exact Windows birth identity');births.set(pid,{startTime:record.startTime,bootId:batch.bootId});};
 let success=false;
 try{
  if(process.platform==='win32'){const {NativeSampler,verifyHelperArtifact}=await import(pathToFileURL(path.join(root,'dist/process/native-helper.js')).href);const helper=path.join(path.resolve(release),'bin','win32-x64','hat-sampler.exe');await verifyHelperArtifact(helper);sampler=new NativeSampler(helper);}
  let ready=false;
  for(let i=0;i<100;i++){if(serverError)throw serverError;if(server.exitCode!==null)throw Error('Isolated Herdr server exited '+server.exitCode);try{await rpc.call('session.snapshot');ready=true;break;}catch{await delay(100);}}
  assert.ok(ready,'isolated server startup');
  const created=await cli(['workspace','create','--cwd',directory,'--label','Plugin acceptance','--focus']);
  const originalTerminal=created.root_pane.terminal_id;
  const startedAt=Date.now();installed=await liveInstall(options);
  const store=new StateStore(path.join(installed.stateDir,'servers',identityName(endpoint)));
  const old=await store.read('controller');assert.ok(old?.terminalId&&old.pid);
  await captureBirth(old.pid);
  const before=(await rpc.call('session.snapshot')).snapshot;
  assert.equal(before.panes.length,2);assert.equal(before.focused_pane_id,created.root_pane.pane_id,'opening preserves native focus');
  const layout=before.layouts.find(item=>item.tab_id===created.tab.tab_id);
  const originalRect=layout?.panes.find(item=>item.pane_id===created.root_pane.pane_id)?.rect;
  const dashboard=before.panes.find(item=>item.terminal_id===old.terminalId);
  const panelRect=layout?.panes.find(item=>item.pane_id===dashboard?.pane_id)?.rect;
  assert.ok(originalRect&&panelRect&&panelRect.x>=originalRect.x+originalRect.width,'right split');
  await waitAction((await cli(['plugin','action','invoke','activate-overview','--plugin','iob.herdr-prism'])).log);
  const after=(await rpc.call('session.snapshot')).snapshot;const current=await store.read('controller');
  assert.equal(after.panes.length,2);assert.ok(!after.panes.some(item=>item.terminal_id===old.terminalId));assert.ok(current?.terminalId&&current.pid);
  assert.notEqual(current.terminalId,old.terminalId);assert.notEqual(current.pid,old.pid);
  await captureBirth(current.pid);
  const removal=await liveUninstall(options);assert.equal(removal.removed,true);installed=undefined;
  const final=(await rpc.call('session.snapshot')).snapshot;assert.equal(final.panes.length,1);assert.equal(final.panes[0].terminal_id,originalTerminal);
  assert.equal((await cli(['plugin','list','--plugin','iob.herdr-prism','--json'])).plugins.length,0);
  for(const dir of [managedDir,removal.purged[0],removal.purged[1]])await assert.rejects(lstat(dir),error=>error.code==='ENOENT');
  assert.equal(await readFile(configPath,'utf8'),original,'pre-install configuration bytes restored');
  if(sampler){const batch=await sampler.sample();for(const pid of [old.pid,current.pid]){const live=batch.processes.find(p=>p.pid===pid),birth=births.get(pid);if(!live)assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH','missing sampler record also requires proven PID absence');else assert.ok(live.startTime!=='0'&&live.availability!=='unavailable'&&(batch.bootId!==birth.bootId||live.startTime!==birth.startTime),'exact Windows collector stopped without an orphan');}}
  else for(const pid of [old.pid,current.pid])assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH','collector stopped without an orphan');
  const version=(await exec(herdr,['--version'],{env,encoding:'utf8'})).stdout.trim();
  const evidence={kind:'actual-herdr-live-lifecycle',version,protocol:before.protocol,node:process.version,platform:process.platform,arch:process.arch,elapsedMs:Date.now()-startedAt,install:true,rightSplit:true,nativeFocusPreserved:true,restartClosedOldOwnedPane:true,uninstall:true,registryRemoved:true,ownedDirectoriesPurged:true,configExactlyRestored:true,preservedOriginalPane:true,collectorsStopped:true,beforePanes:before.panes.length,afterRestartPanes:after.panes.length,afterUninstallPanes:final.panes.length};
  await writeFile(path.join(proof,'lifecycle.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});success=true;return evidence;
 }catch(error){
  const failure={error:String(error),platform:process.platform,node:process.version};
  try{failure.snapshot=(await rpc.call('session.snapshot')).snapshot;failure.logs=(await cli(['plugin','log','list','--plugin','iob.herdr-prism','--limit','64'])).logs;failure.paneText=[];for(const pane of failure.snapshot.panes){const output=await exec(herdr,['--session',name,'pane','read',pane.pane_id,'--source','visible','--lines','60'],{env:options.env,encoding:'utf8',timeout:30000,windowsHide:true});failure.paneText.push({paneId:pane.pane_id,text:output.stdout});}}catch{}
  await writeFile(path.join(proof,'failure.json'),JSON.stringify(failure,null,2)+'\n');throw error;
 }finally{
  await sampler?.close();
  if(installed){try{await liveUninstall(options);}catch(error){await writeFile(path.join(proof,'cleanup-error.txt'),String(error)+'\n',{mode:0o600});}}
  // A failed activation may be registered without returning installed; attempt its
  // authenticated wrapper cleanup when the managed receipt exists.
  if(!success&&!installed){try{await lstat(path.join(managedDir,'.hat-managed-install.json'));await liveUninstall(options);}catch(error){if(error.code!=='ENOENT')await writeFile(path.join(proof,'cleanup-error.txt'),String(error)+'\n',{mode:0o600});}}
  try{if(server.exitCode===null)await cli(['server','stop']);}catch{if(server.exitCode===null)server.kill('SIGTERM');}
  if(server.exitCode===null)await new Promise(resolve=>{const timeout=setTimeout(()=>{server.kill('SIGKILL');resolve();},5000);server.once('exit',()=>{clearTimeout(timeout);resolve();});});
  rpc.close();await handle.close();
  // Failed cleanup remains inspectable; successful runs remove only their own root.
  if(success)await rm(directory,{recursive:true,force:true});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i].slice(2);if(!['release','herdr','proof'].includes(key)||!process.argv[i+1])throw Error('Use --release ROOT [--herdr BIN] [--proof DIR]');options[key]=process.argv[++i];}
 try{console.log(JSON.stringify(await liveHerdrTest(options),null,2));}catch(error){console.error(error.stack??String(error));process.exitCode=1;}
}
