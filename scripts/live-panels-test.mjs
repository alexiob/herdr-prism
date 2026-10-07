import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const exec=promisify(execFile);
async function until(label,probe,timeout=30000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{const value=await probe();if(value)return value;}catch(error){last=error;}await delay(100);}throw Error(label+' timed out'+(last?': '+last.message:''));}

/** All panes, servers, state and synthetic provider directories belong to this run. */
export async function livePanelsTest({release,herdr=process.env.HERDR_BIN_PATH??'herdr',proof='artifacts/live-panels-proof'}={}){
 if(!release)throw Error('--release is required');release=path.resolve(release);proof=path.resolve(proof);await mkdir(proof,{recursive:true});
 if(herdr.includes('/')||herdr.includes('\\'))herdr=path.resolve(herdr);
 const load=file=>import(pathToFileURL(path.join(release,file)));
 const {HerdrClient}=await load('dist/herdr/client.js'),{StateStore,identityName}=await load('dist/state/store.js'),{panelViewStore}=await load('dist/runtime/panel-views.js');
 const {liveInstall,liveUninstall}=await load('scripts/live-install.mjs'),{ensureCollectorService}=await load('dist/runtime/collector-service.js');
 const directory=await mkdtemp(path.join(process.platform==='win32'?os.tmpdir():'/tmp','ppv-'));
 const configHome=path.join(directory,'c'),configPath=path.join(configHome,'herdr/config.toml'),session='panels';
 const original='[server]\nheadless_cols = 140\nheadless_rows = 45\n';await mkdir(path.dirname(configPath),{recursive:true});await writeFile(configPath,original);
 const providerHomes=Object.fromEntries(['codex','claude','pi'].map(p=>[p,path.join(directory,p)]));for(const folder of Object.values(providerHomes))await mkdir(folder);
 const settingsDir=path.join(configHome,'herdr/plugins/config/iob.herdr-prism');await mkdir(settingsDir,{recursive:true});
 await writeFile(path.join(settingsDir,'settings.json'),JSON.stringify({providerHomes,todosEnabled:true,sampleIntervalMs:2000}));
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('HERDR_'))delete env[key];
 Object.assign(env,{XDG_CONFIG_HOME:configHome,XDG_STATE_HOME:path.join(directory,'s'),XDG_DATA_HOME:path.join(directory,'d'),HERDR_CONFIG_PATH:configPath,TERM:'xterm-256color',CODEX_HOME:providerHomes.codex,CLAUDE_CONFIG_DIR:providerHomes.claude,PI_CODING_AGENT_DIR:providerHomes.pi});
 if(process.platform==='win32'){env.APPDATA=configHome;env.LOCALAPPDATA=path.join(directory,'local');}else env.SHELL='/bin/sh';
 const endpoint=path.join(configHome,'herdr/sessions',session,'herdr.sock');env.HERDR_SOCKET_PATH=endpoint;
 const server=spawn(herdr,['--session',session,'server'],{env,cwd:directory,windowsHide:true,stdio:'ignore'});
 let serverError;server.on('error',error=>{serverError=error;});
 const rpc=new HerdrClient(endpoint),cli=async args=>{const output=(await exec(herdr,['--session',session,...args],{env,windowsHide:true,timeout:30000,maxBuffer:4*1024*1024})).stdout.trim();return output?JSON.parse(output).result:{};};
 const snapshot=async()=>(await rpc.call('session.snapshot')).snapshot;
 const options={root:release,managedDir:path.join(directory,'managed'),herdrBin:herdr,herdrPrefix:['--session',session],env,timeoutMs:30000};
 let installed,success=false,detachedStore;
 const result={kind:'actual-isolated-independent-panels',node:process.version,platform:process.platform,ok:false};
 const waitAction=async log=>until('action completion',async()=>{const entry=(await cli(['plugin','log','list','--plugin','iob.herdr-prism','--limit','256'])).logs.find(l=>l.log_id===log.log_id);if(entry?.status==='failed')throw Error(entry.stderr||entry.error);return entry?.status==='succeeded';});
 try{
  await until('server ready',async()=>{if(serverError)throw serverError;return snapshot();});
  const created=await cli(['workspace','create','--cwd',directory,'--label','Panel fixtures','--focus']);const alpha=created.root_pane;
  const beta=(await cli(['tab','create','--workspace',created.workspace.workspace_id,'--cwd',directory,'--label','Other fixture','--no-focus'])).root_pane;
  const gamma=(await cli(['pane','split',alpha.pane_id,'--direction','down','--no-focus'])).pane;
  installed=await liveInstall(options);const store=new StateStore(path.join(installed.stateDir,'servers',identityName(endpoint)));
  const owner=await store.read('controller');const first=(await store.read('views')).find(r=>r.targetTerminalId===alpha.terminal_id);assert.ok(first?.open);
  const shown=async terminal=>{const current=await snapshot(),p=current.panes.find(p=>p.terminal_id===terminal),record=(await store.read('views'))?.find(row=>row.terminalId===terminal);if(!p||!record?.open||!record.ready||p.tab_id!==current.focused_tab_id)return;const output=await exec(herdr,['--session',session,'pane','read',p.pane_id,'--source','visible','--lines','60'],{env,windowsHide:true});return output.stdout.includes('Overview')&&p;};
  await until('first view rendered',()=>shown(first.terminalId));
  await cli(['tab','focus',beta.tab_id]);await waitAction((await cli(['plugin','action','invoke','open','--plugin','iob.herdr-prism'])).log);
  const second=(await store.read('views')).find(r=>r.targetTerminalId===beta.terminal_id);assert.ok(second?.open);assert.notEqual(second.terminalId,first.terminalId);
  await until('second view rendered',()=>shown(second.terminalId));
  assert.equal((await snapshot()).panes.length,5);assert.equal((await store.read('controller')).pid,owner.pid);
  await cli(['pane','focus','--pane',alpha.pane_id,'--direction','down']);assert.equal((await snapshot()).focused_pane_id,gamma.pane_id);await waitAction((await cli(['plugin','action','invoke','open','--plugin','iob.herdr-prism'])).log);
  const sameTab=(await store.read('views')).find(r=>r.targetTerminalId===gamma.terminal_id);assert.ok(sameTab?.open);assert.equal(sameTab.tabId,first.tabId);assert.notEqual(sameTab.terminalId,first.terminalId);await until('same-tab view rendered',()=>shown(sameTab.terminalId));
  const sameTabSnapshot=await snapshot(),layout=sameTabSnapshot.layouts.find(l=>l.tab_id===alpha.tab_id);
  for(const [native,view] of [[alpha,first],[gamma,sameTab]]){const nativeRect=layout.panes.find(p=>p.pane_id===native.pane_id)?.rect,viewPane=sameTabSnapshot.panes.find(p=>p.terminal_id===view.terminalId),viewRect=layout.panes.find(p=>p.pane_id===viewPane.pane_id)?.rect;assert.ok(nativeRect&&viewRect&&viewRect.x>=nativeRect.x+nativeRect.width&&viewRect.y===nativeRect.y,'each same-tab panel is beside its own native terminal');assert.ok(viewRect.width<=61,'Prism defaults to at most about60 columns');}
  result.simultaneousSameTabPanels=true;result.correctNativeAdjacency=true;
  const firstPane=sameTabSnapshot.panes.find(p=>p.terminal_id===first.terminalId),firstRect=layout.panes.find(p=>p.pane_id===firstPane.pane_id).rect;
  const tree=(await rpc.call('layout.export',{pane_id:firstPane.pane_id})).layout.root;
  const widthSplit=(node,path=[])=>{if(node?.type!=='split')return;if(node.direction==='right'&&node.first?.pane_id===alpha.pane_id&&node.second?.pane_id===firstPane.pane_id)return{path,ratio:node.ratio};return widthSplit(node.first,[...path,false])??widthSplit(node.second,[...path,true]);};
  const split=widthSplit(tree),region=layout.splits.filter(s=>s.direction==='right'&&s.rect.y<=firstRect.y&&s.rect.y+s.rect.height>=firstRect.y+firstRect.height&&s.rect.x<=firstRect.x&&s.rect.x+s.rect.width>=firstRect.x+firstRect.width).sort((a,b)=>a.rect.width*a.rect.height-b.rect.width*b.rect.height)[0];assert.ok(split&&region);
  await rpc.call('layout.set_split_ratio',{pane_id:firstPane.pane_id,path:split.path,ratio:split.ratio+(firstRect.width-45)/region.rect.width});
  const sizeStore=panelViewStore(store.dir,alpha.tab_id,alpha.terminal_id),savedWidth=await until('individual panel width saved',async()=>{const size=await sizeStore.read('panel-size');return size?.custom&&Math.abs(size.columns-45)<=1&&size.columns;});
  assert.equal((await panelViewStore(store.dir,gamma.tab_id,gamma.terminal_id).read('panel-size')).custom,false,'resizing alpha does not overwrite gamma preference');

  await cli(['pane','focus','--pane',gamma.pane_id,'--direction','up']);assert.equal((await snapshot()).focused_pane_id,alpha.pane_id);await waitAction((await cli(['plugin','action','invoke','open','--plugin','iob.herdr-prism'])).log);
  assert.equal((await snapshot()).panes.length,6);assert.equal((await store.read('controller')).pid,owner.pid);
  const own=(await snapshot()).panes.find(p=>p.terminal_id===first.terminalId);await cli(['pane','send-text',own.pane_id,'q']);
  await until('only first view closes',async()=>!(await snapshot()).panes.some(p=>p.terminal_id===first.terminalId));
  assert.ok((await snapshot()).panes.some(p=>p.terminal_id===sameTab.terminalId));
  assert.ok((await snapshot()).panes.some(p=>p.terminal_id===second.terminalId));assert.equal((await store.read('controller')).pid,owner.pid);
  assert.equal((await store.read('views')).find(r=>r.targetTerminalId===alpha.terminal_id).open,false);
  await cli(['tab','focus',alpha.tab_id]);await waitAction((await cli(['plugin','action','invoke','activate-overview','--plugin','iob.herdr-prism'])).log);
  const restarted=await store.read('controller'),rows=await store.read('views');assert.notEqual(restarted.pid,owner.pid);
  assert.equal(rows.find(r=>r.targetTerminalId===alpha.terminal_id).open,false);assert.equal(rows.find(r=>r.targetTerminalId===beta.terminal_id).open,true);
  assert.equal(rows.find(r=>r.targetTerminalId===gamma.terminal_id).open,true);
  await cli(['tab','focus',beta.tab_id]);assert.equal((await snapshot()).focused_tab_id,beta.tab_id);
  await until('remembered second view rendered visibly and ready',()=>shown(rows.find(r=>r.targetTerminalId===beta.terminal_id).terminalId));
  await rpc.call('pane.focus',{pane_id:gamma.pane_id});assert.equal((await snapshot()).focused_pane_id,gamma.pane_id);
  await until('remembered same-tab view rendered visibly and ready',()=>shown(rows.find(r=>r.targetTerminalId===gamma.terminal_id).terminalId));assert.equal((await snapshot()).panes.length,5);
  result.independentPanels=true;result.repeatedOpenDidNotDuplicate=true;result.closePreservedOtherPanelAndCollector=true;result.restartPreservedOpenAndClosedTabs=true;
  await cli(['pane','focus','--pane',gamma.pane_id,'--direction','up']);assert.equal((await snapshot()).focused_pane_id,alpha.pane_id);await waitAction((await cli(['plugin','action','invoke','open','--plugin','iob.herdr-prism'])).log);
  const reopened=(await store.read('views')).find(r=>r.targetTerminalId===alpha.terminal_id);await until('resized panel reopened',()=>shown(reopened.terminalId));
  const restored=await snapshot(),restoredPane=restored.panes.find(p=>p.terminal_id===reopened.terminalId),restoredWidth=restored.layouts.find(l=>l.tab_id===alpha.tab_id).panes.find(p=>p.pane_id===restoredPane.pane_id).rect.width;
  assert.ok(Math.abs(restoredWidth-savedWidth)<=1,'per-agent width survives pane and collector recreation');result.independentWidthsRestored=true;
  await cli(['pane','send-text',restoredPane.pane_id,'q']);await until('reopened fixture view closes',async()=>!(await snapshot()).panes.some(p=>p.terminal_id===reopened.terminalId));

  await waitAction((await cli(['plugin','action','invoke','deactivate','--plugin','iob.herdr-prism'])).log);
  assert.equal((await snapshot()).panes.length,3);assert.equal(await readFile(configPath,'utf8'),original);
  await waitAction((await cli(['plugin','action','invoke','activate-overview','--plugin','iob.herdr-prism'])).log);
  assert.match(await readFile(configPath,'utf8'),/key = "prefix\+i"/);result.shortcutRestoredAfterDeactivateReactivate=true;
  await liveUninstall(options);installed=undefined;assert.equal((await snapshot()).panes.length,3);assert.equal(await readFile(configPath,'utf8'),original);result.completeUninstallPreservedNativePanes=true;
  // Start a separate proven owner with no views, then stop only our named server.
  const stateDir=path.join(directory,'liveness-state'),configDir=path.join(directory,'liveness-config');await new StateStore(stateDir).init();await new StateStore(configDir).write('settings',{providerHomes,nativeMode:'inspector-only',todosEnabled:true,sampleIntervalMs:2000});
  const context={stateDir,configDir,configPath,endpoint,serverStateDir:path.join(stateDir,'servers',identityName(endpoint))};
  let background=await ensureCollectorService(context);detachedStore=new StateStore(context.serverStateDir);
  const crashedPid=background.marker.pid;process.kill(crashedPid,'SIGKILL');
  await until('owned crash exits',async()=>{try{process.kill(crashedPid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}});
  background=await ensureCollectorService(context);assert.notEqual(background.marker.pid,crashedPid);result.abruptCollectorDeathRecovered=true;
  await cli(['server','stop']);
  await until('detached owner stops after server loss',async()=>!(await detachedStore.read('controller')),20000);
  // The controller receipt is removed during cleanup, before the process finishes exiting.
  await until('detached collector process exits',async()=>{try{process.kill(background.marker.pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}},20000);
  // Assert complete lock cleanup only after the owner has actually exited,
  // rather than racing its earlier controller-receipt removal.
  await assert.rejects(lstat(path.join(context.serverStateDir,'collector.lock')),{code:'ENOENT'});result.serverLossStoppedCollector=true;
  result.ok=true;await writeFile(path.join(proof,'panels.json'),JSON.stringify(result,null,2));success=true;return result;
 }catch(error){result.error=String(error);try{result.logs=(await cli(['plugin','log','list','--plugin','iob.herdr-prism','--limit','32'])).logs;result.snapshot=await snapshot();result.prismText=[];for(const pane of result.snapshot.panes.filter(p=>p.label==='Prism'))result.prismText.push((await exec(herdr,['--session',session,'pane','read',pane.pane_id,'--source','visible','--lines','60'],{env,windowsHide:true})).stdout);}catch{}await writeFile(path.join(proof,'failure.json'),JSON.stringify(result,null,2));throw error;}
 finally{
  if(installed)await liveUninstall(options).catch(()=>{});
  try{if(server.exitCode===null)await cli(['server','stop']);}catch{if(server.exitCode===null)server.kill();}
  rpc.close();
  if(server.exitCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>{server.kill();resolve();},5000);server.once('exit',()=>{clearTimeout(timer);resolve();});});
  if(success){assert.equal(path.dirname(directory),path.resolve(process.platform==='win32'?os.tmpdir():'/tmp'));await rm(directory,{recursive:true,force:true});}
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i].slice(2);if(!['release','herdr','proof'].includes(key)||!process.argv[i+1])throw Error('Use --release ROOT --herdr BIN --proof DIR');options[key]=process.argv[++i];}
 try{console.log(JSON.stringify(await livePanelsTest(options),null,2));}catch(error){console.error(error.stack??String(error));process.exitCode=1;}
}
