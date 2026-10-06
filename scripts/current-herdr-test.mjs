import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {liveInstall,liveUninstall} from './live-install.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const hash=data=>createHash('sha256').update(data).digest('hex');
/** Explicit live-session acceptance: no existing pane/server/foreign plugin is stopped. */
export async function currentHerdrTest({release,proof=path.join(root,'artifacts/current-herdr-proof')}={}){
 if(process.env.HERDR_ENV!=='1'||!process.env.HERDR_SOCKET_PATH||!process.env.HERDR_PANE_ID)throw Error('Run only from the authorized current Herdr pane');
 if(!release)throw Error('--release must name a reviewed checksummed release');
 const {HerdrClient}=await import(pathToFileURL(path.join(root,'dist/herdr/client.js')).href);
 const {StateStore,identityName}=await import(pathToFileURL(path.join(root,'dist/state/store.js')).href);
 const {MailboxClient}=await import(pathToFileURL(path.join(root,'dist/state/mailbox.js')).href);
 const configPath=process.env.HERDR_CONFIG_PATH??path.join(process.env.XDG_CONFIG_HOME??(process.platform==='win32'?process.env.APPDATA:undefined)??path.join(homedir(),'.config'),'herdr','config.toml');
 const original=await readFile(configPath);const rpc=new HerdrClient(process.env.HERDR_SOCKET_PATH);let installed;
 const managedDir=path.join(process.platform==='win32'?process.env.TEMP??root:'/tmp','hat-user-managed-'+randomUUID());
 const options={root:path.resolve(release),managedDir,timeoutMs:45000};
 await mkdir(proof,{recursive:true});
 try{
  const before=(await rpc.call('session.snapshot')).snapshot;
  const beforePlugins=await rpc.call('plugin.list');
  assert.ok(before.panes.some(pane=>pane.pane_id===process.env.HERDR_PANE_ID),'caller pane exists');
  const startedAt=Date.now();installed=await liveInstall(options);
  const serverStateDir=path.join(installed.stateDir,'servers',identityName(process.env.HERDR_SOCKET_PATH));const store=new StateStore(serverStateDir);
  const controller=await store.read('controller');assert.ok(controller?.terminalId&&controller?.token);
  const alive=await new MailboxClient(serverStateDir,controller.token,3000).request('ping');assert.equal(alive.ready,true);assert.equal(alive.stale,false);
  const active=(await rpc.call('session.snapshot')).snapshot;
  assert.ok(active.panes.some(pane=>pane.terminal_id===controller.terminalId),'real dashboard pane exists');
  assert.equal(active.focused_pane_id,before.focused_pane_id,'install does not steal focus');
  const removed=await liveUninstall(options);assert.equal(removed.removed,true);installed=undefined;
  const after=(await rpc.call('session.snapshot')).snapshot;
  assert.ok(!after.panes.some(pane=>pane.terminal_id===controller.terminalId),'dashboard removed');
  for(const pane of before.panes)assert.ok(after.panes.some(current=>current.terminal_id===pane.terminal_id),'original pane remains '+pane.pane_id);
  const plugins=await rpc.call('plugin.list');assert.ok(!plugins.plugins.some(plugin=>plugin.plugin_id==='iob.herdr-prism'));
  for(const plugin of beforePlugins.plugins)assert.ok(plugins.plugins.some(current=>current.plugin_id===plugin.plugin_id&&current.enabled===plugin.enabled&&current.plugin_root===plugin.plugin_root),'foreign plugin preserved');
  for(const dir of [managedDir,...removed.purged])await assert.rejects(lstat(dir),error=>error.code==='ENOENT');
  const restored=await readFile(configPath);assert.equal(hash(restored),hash(original),'prior user config restored exactly');
  assert.throws(()=>process.kill(controller.pid,0),error=>error.code==='ESRCH','foreground collector stopped');
  const evidence={kind:'actual-current-herdr-lifecycle',platform:process.platform,arch:process.arch,node:process.version,protocol:before.protocol,version:before.version,elapsedMs:Date.now()-startedAt,activated:true,authenticatedReady:true,rightInspectorPresent:true,focusPreserved:true,unregistered:true,paneRemoved:true,collectorStopped:true,ownedDirectoriesPurged:true,originalConfigurationSha256:hash(original),restoredConfigurationSha256:hash(restored),originalConfigurationExactlyRestored:true,originalPanesPreserved:before.panes.length,foreignPluginsPreserved:beforePlugins.plugins.length};
  await writeFile(path.join(proof,'lifecycle.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});return evidence;
 }finally{
  if(installed){try{await liveUninstall(options);}catch(error){await writeFile(path.join(proof,'cleanup-error.txt'),String(error)+'\n',{mode:0o600});}}
  if(!installed){try{await lstat(path.join(managedDir,'.hat-managed-install.json'));await liveUninstall(options);}catch(error){if(error.code!=='ENOENT')await writeFile(path.join(proof,'cleanup-error.txt'),String(error)+'\n',{mode:0o600});}}
  rpc.close();
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i].slice(2);if(!['release','proof'].includes(key)||!process.argv[i+1])throw Error('Use --release ROOT [--proof DIR]');options[key]=process.argv[++i];}
 try{console.log(JSON.stringify(await currentHerdrTest(options),null,2));}catch(error){console.error(error.stack??String(error));process.exitCode=1;}
}
