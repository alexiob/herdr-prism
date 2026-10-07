import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,readFile,readdir,realpath,open,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {checkInstall,checkedRead} from './check-install.mjs';

const exec=promisify(execFile),pluginId='iob.herdr-prism';
const endpointValue=value=>typeof value==='string'&&value.length>0&&value.length<=2048&&!/[\x00\r\n]/.test(value);
const absent=error=>['ENOENT','ECONNREFUSED'].includes(error?.code)||/connect (ENOENT|ECONNREFUSED)/.test(error?.message??'');
function result(value){return typeof value==='string'?JSON.parse(value):value?.stdout!==undefined?JSON.parse(value.stdout):value;}
async function regular(path,optional=false,owned=false){try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024||owned&&process.platform!=='win32'&&stat.uid!==process.getuid())throw Error('Unsafe update state file');return {body:await readFile(path,'utf8'),mode:stat.mode&0o777};}catch(error){if(optional&&error.code==='ENOENT')return;throw error;}}
async function directory(path){const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||process.platform!=='win32'&&stat.uid!==process.getuid())throw Error('Unsafe update directory');return realpath(path);}
const parsed=file=>{if(file===undefined)return;try{return JSON.parse(file.body);}catch{throw Error('Invalid private update metadata JSON');}};
async function defaultRuntime(root){const load=file=>import(pathToFileURL(join(root,'dist',file)).href);const [store,client,lifecycle,safe,config]=await Promise.all([load('state/store.js'),load('herdr/client.js'),load('runtime/lifecycle.js'),load('config/safe-file.js'),load('config/index.js')]);return{...store,...client,...lifecycle,...safe,loadSettings:config.loadSettings};}
function namespace(options,env,receipt){
 const configBase=env.XDG_CONFIG_HOME??(process.platform==='win32'?env.APPDATA:undefined)??(process.platform==='win32'&&env.USERPROFILE?join(env.USERPROFILE,'AppData','Roaming'):join(env.HOME??homedir(),'.config'));
 const home=env.HOME??homedir();
 const stateBase=env.XDG_STATE_HOME??(process.platform==='win32'?env.LOCALAPPDATA??(env.USERPROFILE?join(env.USERPROFILE,'AppData','Local'):undefined):undefined)??join(home,'.local','state');
 const pluginEnv=env.HERDR_PLUGIN_ID===pluginId?env:{};
 return {configDir:resolve(options.configDir??receipt?.configDir??pluginEnv.HERDR_PLUGIN_CONFIG_DIR??join(configBase,'herdr','plugins','config',pluginId)),stateDir:resolve(options.stateDir??receipt?.stateDir??pluginEnv.HERDR_PLUGIN_STATE_DIR??join(stateBase,'herdr','plugins',pluginId)),configPath:resolve(options.configPath??env.HERDR_CONFIG_PATH??join(configBase,'herdr','config.toml'))};
}
async function registration(cli,endpoint){const data=result(await cli(['plugin','list','--plugin',pluginId,'--json'],endpoint));if(data?.result?.type!=='plugin_list'||!Array.isArray(data.result.plugins))throw Error('Unsupported plugin registration response');const matching=data.result.plugins.filter(value=>value?.plugin_id===pluginId);if(matching.length!==1||typeof matching[0].enabled!=='boolean'||typeof matching[0].plugin_root!=='string')throw Error('Missing or ambiguous Prism registration');return matching[0];}
async function validateRegistration(info,expected){const path=await directory(resolve(info.plugin_root));if(expected&&path!==expected)throw Error('Foreign Prism registration on a recorded server');const receipt=parsed(await regular(join(path,'.hat-managed-install.json'),true,true));if(receipt!==undefined&&(!receipt||receipt.version!==1||receipt.pluginId!==pluginId||typeof receipt.token!=='string'||receipt.token.length<16||receipt.installRoot!==path))throw Error('Invalid managed installation ownership receipt');if(info.source?.kind==='github'){if(info.source.owner!=='alexiob'||info.source.repo!=='herdr-prism'||typeof info.source.managed_path!=='string'||await realpath(info.source.managed_path)!==path)throw Error('Foreign GitHub plugin registration');}else if(!receipt)throw Error('Unsupported local registration without managed ownership receipt');return{path,receipt};}
async function validateNamespaceOwnership(context,receipt,installedRoot){
 if(!receipt)return;
 for(const dir of [context.configDir,context.stateDir]){
  let marker;try{marker=parsed(await regular(join(dir,'.hat-lifecycle-owner.json'),false,true));}catch{throw Error('Managed namespace ownership marker is missing or invalid');}
  if(!marker||marker.version!==1||marker.pluginId!==pluginId||marker.token!==receipt.token||typeof marker.installRoot!=='string'||resolve(marker.installRoot)!==installedRoot||await realpath(marker.installRoot)!==installedRoot)throw Error('Managed namespace ownership marker mismatch');
 }
}
function validateViews(value){const views=value??[];if(!Array.isArray(views)||views.length>128||views.some(view=>!view||typeof view.tabId!=='string'||typeof view.paneId!=='string'||typeof view.terminalId!=='string'||typeof view.open!=='boolean'||typeof view.targetTerminalId!=='string'||!view.targetTerminalId))throw Error('Unsupported panel ownership records; exact target bindings are required');return structuredClone(views);}
function captureFocus(snapshot,views){if(!snapshot.focused_pane_id)return;const pane=snapshot.panes.find(value=>value.pane_id===snapshot.focused_pane_id);if(!pane||typeof pane.terminal_id!=='string')throw Error('Snapshot cannot identify its focused pane');const own=views.find(view=>view.open&&view.terminalId===pane.terminal_id&&view.paneId===pane.pane_id);return own?{kind:'prism',targetTerminalId:own.targetTerminalId,tabId:own.tabId}:{kind:'native',terminalId:pane.terminal_id};}
/** Update code after shutdown, retaining only the metadata needed to restart it.
 * operations is an explicit test/embedding seam; private notebooks are never read.
 * Prepared transactions supply rollback before replace can partially mutate files. */
export async function updatePrism(options={}){
 const transaction=options.transaction;
 if(transaction&&(!transaction.replace||!transaction.rollback)||!transaction&&typeof options.replace!=='function')throw Error('Update requires a replacement callback or prepared replacement/rollback transaction');
 const operations=options.operations??{},env={...process.env,...options.env},timeoutMs=options.timeoutMs??60000;
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>300000)throw Error('Update timeout must be 100–300000 ms');
 let root=resolve(options.root??'.');
 let runtime,context,state,lock,journal,servers=[],installedRoot,info,stopping=false,replacing=false,rollback=transaction?.rollback,completed=false;
 const cli=async(args,endpoint)=>{const invocation={herdrBin:options.herdrBin??env.HERDR_BIN_PATH??'herdr',session:endpoint?undefined:options.session,endpoint,env:{...env,...endpoint?{HERDR_SOCKET_PATH:endpoint}:{}},timeoutMs};return operations.cli?operations.cli(args,invocation):exec(invocation.herdrBin,[...invocation.session?['--session',invocation.session]:[],...args],{env:invocation.env,windowsHide:true,encoding:'utf8',timeout:timeoutMs,maxBuffer:4*1024*1024});};
 const saveJournal=async phase=>{journal={...journal,phase,updatedAt:Date.now()};await state.write('update-recovery',journal);};
 const restoreFile=async(path,file)=>{if(file===undefined)await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});else await runtime.atomicWrite(path,file.body,file.mode);};
 const settingsFiles=()=>[[join(context.configDir,'settings.json'),journal.original.settings],[join(context.configDir,'shortcut-preference.json'),journal.original.shortcut]];
 const restoreSettings=async()=>{for(const [path,file]of settingsFiles())await restoreFile(path,file);};
 const relay=async(original=false)=>{if(!servers.some(server=>server.live))return;const source=original?info.source:(await registration(cli,servers.find(server=>server.live)?.endpoint)).source;for(const server of servers.filter(value=>value.live)){await server.rpc.call('plugin.link',{path:installedRoot,enabled:false,source});}};
 const recoveryInfo=()=>({journal:join(context.stateDir,'update-recovery.json'),...Object.fromEntries(['backup','prepared','lock','snapshot','discard'].filter(key=>typeof transaction?.recovery?.[key]==='string').map(key=>[key,transaction.recovery[key]]))});
 const restoreFocus=async(server)=>{
  if(!server.focus)return;
  const snapshot=(await server.rpc.call('session.snapshot')).snapshot;
  let pane;
  if(server.focus.kind==='prism'){
   const views=await server.store.read('views')??[];
   const record=views.find(view=>view.open&&view.targetTerminalId===server.focus.targetTerminalId&&view.tabId===server.focus.tabId);
   pane=record&&snapshot.panes.find(value=>value.terminal_id===record.terminalId&&value.pane_id===record.paneId);
   if(!pane)throw Error('Updated Prism panel focus target is unavailable');
   if(snapshot.focused_pane_id!==pane.pane_id)await server.rpc.call('plugin.pane.focus',{pane_id:pane.pane_id});
  }else{
   pane=snapshot.panes.find(value=>value.terminal_id===server.focus.terminalId);
   if(!pane)throw Error('Original native focus target is unavailable');
   if(snapshot.focused_pane_id!==pane.pane_id)await server.rpc.call('pane.focus',{pane_id:pane.pane_id});
  }
  const verified=(await server.rpc.call('session.snapshot')).snapshot;
  if(verified.focused_pane_id!==pane.pane_id)throw Error('Herdr did not restore the exact focused pane');
 };
 const activateServer=async(server,recovering=false)=>{
  await restoreSettings();if(journal.original.shortcut===undefined)await new runtime.StateStore(context.configDir).write('shortcut-preference',{enabled:journal.shortcut});
  await server.store.write('views',server.views);
  if(server.active){
   const action=journal.mode==='inspector-only'?'activate-inspector':journal.ownNative?'activate-overview':'activate';
   const actionEnv={...env,HERDR_PLUGIN_ID:pluginId,HERDR_PLUGIN_ROOT:installedRoot,HERDR_PLUGIN_CONFIG_DIR:context.configDir,HERDR_PLUGIN_STATE_DIR:context.stateDir,HERDR_SOCKET_PATH:server.endpoint,HERDR_CONFIG_PATH:context.configPath};
   const invocation={endpoint:server.endpoint,context:{...context,endpoint:server.endpoint,serverStateDir:server.dir},action,root:installedRoot,lifecycleRoot:root,recovering,nodeBin:options.nodeBin??process.execPath,env:actionEnv,timeoutMs};
   let value;if(operations.activate)value=await operations.activate(invocation);else{try{const args=recovering?[join(root,'scripts/update-activate.mjs'),'--runtime-root',installedRoot,'--lifecycle-root',root,'--mode',journal.mode,...journal.ownNative?['--own-native']:[]]:[join(installedRoot,'dist/entrypoints/action.js'),action,'--restore-views-only'];const output=await exec(invocation.nodeBin,args,{env:actionEnv,encoding:'utf8',windowsHide:true,timeout:timeoutMs,maxBuffer:4*1024*1024});value=JSON.parse(output.stdout);}catch(error){throw Error('Prism activation subprocess failed',{cause:error});}}
   if(value?.activated!==true||typeof value.configDir!=='string'||typeof value.stateDir!=='string'||resolve(value.configDir)!==context.configDir||resolve(value.stateDir)!==context.stateDir||!Array.isArray(value.conflicts)||value.conflicts.length)throw Error('Activation did not prove readiness in the captured plugin namespaces');
  }
  await restoreFocus(server);
 };
 const restoreOriginal=async()=>{
  await restoreSettings();await restoreFile(join(context.stateDir,'lifecycle.json'),journal.original.lifecycle);
  for(const server of servers.filter(value=>!value.live))await server.store.write('views',server.views);
 };
 try{
  root=await realpath(root);
  const checked=operations.validateSource?await operations.validateSource(root):await checkInstall({root});if(checked?.ok===false)throw Error('Reviewed update source failed distribution checks');const pkg=JSON.parse(await checkedRead(root,'package.json',1024*1024));if(pkg.name!=='herdr-prism'||pkg.type!=='module'||!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(pkg.version))throw Error('Invalid reviewed Prism update source');
  if(!operations.activate)await checkedRead(root,'scripts/update-activate.mjs',65536);
  runtime=operations.loadRuntime?await operations.loadRuntime(root):await defaultRuntime(root);
  info=await registration(cli);const owned=await validateRegistration(info);installedRoot=owned.path;context=namespace(options,env,owned.receipt);
  await directory(context.configDir);await directory(context.stateDir);await validateNamespaceOwnership(context,owned.receipt,installedRoot);state=new runtime.StateStore(context.stateDir);
  const original={settings:await regular(join(context.configDir,'settings.json'),true),shortcut:await regular(join(context.configDir,'shortcut-preference.json'),true),lifecycle:await regular(join(context.stateDir,'lifecycle.json'),true),configuration:await regular(join(context.stateDir,'configuration.json'),true),config:await regular(context.configPath,true)};
  await runtime.loadSettings?.(context.configDir);
  const settings=parsed(original.settings)??{},lifecycle=parsed(original.lifecycle)??{},manifest=parsed(original.configuration),shortcut=parsed(original.shortcut);
  if(lifecycle.removing||settings.nativeMode!==undefined&&!['overview','inspector-only','native'].includes(settings.nativeMode)||shortcut!==undefined&&typeof shortcut.enabled!=='boolean')throw Error('Unsupported plugin lifecycle/settings state');
  const ownerNative=!!manifest?.values?.some(value=>value.path?.startsWith('ui.sidebar.agents.'));
  const candidates=new Map();const serverBase=join(context.stateDir,'servers');for(const entry of await readdir(serverBase,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return[];throw error;})){if(!entry.isDirectory()||entry.isSymbolicLink()||!/^[a-f0-9]{64}$/.test(entry.name))throw Error('Unsafe recorded server directory');const dir=join(serverBase,entry.name),store=new runtime.StateStore(dir),endpoint=(await store.read('server'))?.endpoint;if(!endpointValue(endpoint))throw Error('Recorded server endpoint unavailable');if(runtime.identityName(endpoint)!==entry.name)throw Error('Recorded server endpoint identity mismatch');candidates.set(endpoint,{dir,store});}
  const status=result(await cli(['status','server','--json']));if(status.running===true){if(!endpointValue(status.socket))throw Error('Selected running server endpoint unavailable');if(!candidates.has(status.socket)){const dir=join(serverBase,runtime.identityName(status.socket));candidates.set(status.socket,{dir,store:new runtime.StateStore(dir)});}}
  const rpcFactory=operations.rpcFactory??(endpoint=>new runtime.HerdrClient(endpoint,{timeoutMs}));
  for(const [endpoint,value]of candidates){const views=validateViews(await value.store.read('views')),controller=await value.store.read('controller');if(controller&&(!Number.isSafeInteger(controller.pid)||controller.pid<1))throw Error('Uncertain recorded collector identity');const controllerLive=!!controller&&!runtime.processIsAbsent(controller.pid);const rpc=rpcFactory(endpoint);let snapshot;try{snapshot=(await rpc.call('session.snapshot')).snapshot;}catch(error){if(controllerLive||!absent(error)){rpc.close?.();throw Error('Unable to snapshot a recorded live Herdr server',{cause:error});}servers.push({...value,endpoint,rpc,views,live:false});continue;}
   if(!snapshot||snapshot.protocol!==22||!Array.isArray(snapshot.panes)||!Array.isArray(snapshot.agents)){rpc.close?.();throw Error('Unsupported live Herdr snapshot');}
   const registered=await registration(cli,endpoint);await validateRegistration(registered,installedRoot);
   const livePanel=views.some(view=>view.open&&snapshot.panes.some(pane=>pane.terminal_id===view.terminalId&&pane.pane_id===view.paneId));
   const active=registered.enabled&&lifecycle.disabled!==true&&(controllerLive||livePanel);
   if(active)for(const view of views.filter(value=>value.open)){const panel=snapshot.panes.find(pane=>pane.terminal_id===view.terminalId&&pane.pane_id===view.paneId&&pane.tab_id===view.tabId),target=snapshot.panes.find(pane=>pane.terminal_id===view.targetTerminalId&&pane.tab_id===view.tabId);if(!panel||!target)throw Error('Unable to snapshot exact open Prism panel/target identity');}
   const focus=captureFocus(snapshot,views);if(!active&&focus?.kind==='prism')throw Error('Unsupported inactive installation with a still-focused live Prism panel');
   servers.push({...value,endpoint,rpc,views,registration:registered,focus,live:true,controllerLive,active});
  }
  lock=await open(join(context.stateDir,'update.lock'),'wx',0o600);await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:Date.now(),token:randomUUID()}));
  const pending=await state.read('update-recovery');if(pending&&!['complete','rolled-back'].includes(pending.phase))throw Error('A previous update requires recovery; replacement refused');
  journal={version:1,pluginId,transaction:transaction?.recovery,sourceRoot:root,installedRoot,versionTarget:pkg.version,original,mode:settings.nativeMode==='inspector-only'?'inspector-only':ownerNative?'overview':'inspector-only',ownNative:ownerNative,shortcut:shortcut?.enabled??!!manifest?.blocks?.length,servers:servers.map(({rpc,store,...server})=>server),phase:'captured'};await saveJournal('captured');
  stopping=true;const selected=servers.find(server=>server.live);if(selected){const stopped=await runtime.deactivate({...context,endpoint:selected.endpoint,serverStateDir:selected.dir},selected.rpc,{timeoutMs,rpcFactory});if(stopped?.deactivated!==true||!Array.isArray(stopped.conflicts)||stopped.conflicts.length)throw Error('Prism deactivation did not complete');}
  await saveJournal('stopped');replacing=true;const replacement=await (transaction?transaction.replace(info):options.replace(info));if(!transaction)rollback=typeof replacement==='function'?replacement:replacement?.rollback;if(typeof rollback!=='function')throw Error('Replacement did not provide a rollback operation');await saveJournal('replaced');
  await relay();for(const server of servers.filter(value=>value.live))await cli(['plugin',server.registration.enabled?'enable':'disable',pluginId],server.endpoint);await saveJournal('restoring');for(const server of servers.filter(value=>value.live))await activateServer(server);await restoreOriginal();await saveJournal('complete');completed=true;let cleanupPending=false;try{await transaction?.finish?.();}catch{cleanupPending=true;await saveJournal('complete').catch(()=>{});}return {updated:true,...cleanupPending?{cleanupPending:true,recovery:recoveryInfo()}:{},pluginId,version:pkg.version,installedRoot,configDir:context.configDir,stateDir:context.stateDir,servers:servers.filter(value=>value.live).length};
 }catch(error){
  if(stopping&&journal){let recoveryError;try{const selected=servers.find(server=>server.live);if(replacing&&selected)await runtime.deactivate({...context,endpoint:selected.endpoint,serverStateDir:selected.dir},selected.rpc,{timeoutMs,rpcFactory:operations.rpcFactory??(endpoint=>new runtime.HerdrClient(endpoint,{timeoutMs}))});if(replacing){if(typeof rollback!=='function')throw Error('Replacement failed without a known rollback operation');await rollback();}await restoreFile(context.configPath,journal.original.config);await restoreFile(join(context.stateDir,'configuration.json'),journal.original.configuration);await relay(true);for(const server of servers.filter(value=>value.live))await cli(['plugin',server.registration.enabled?'enable':'disable',pluginId],server.endpoint);for(const server of servers.filter(value=>value.live))await activateServer(server,true);await restoreOriginal();await restoreFile(context.configPath,journal.original.config);await restoreFile(join(context.stateDir,'configuration.json'),journal.original.configuration);for(const server of servers.filter(value=>value.live))await server.rpc.call('server.reload_config');await saveJournal('rolled-back');try{await transaction?.finish?.();}catch{journal={...journal,cleanupPending:true};await saveJournal('rolled-back');}}catch(failed){recoveryError=failed;await saveJournal('recovery-required').catch(()=>{});}if(recoveryError)throw Error('Prism update failed and recovery is incomplete; recovery journal: '+join(context.stateDir,'update-recovery.json')+(transaction?.recovery?.backup?'; original code backup: '+transaction.recovery.backup:''),{cause:new AggregateError([error,recoveryError])});throw Error('Prism update failed; original code and panel state restored'+(journal.cleanupPending?'; cleanup pending; '+Object.entries(recoveryInfo()).map(([name,path])=>name+': '+path).join('; '):''),{cause:error});}
  throw error;
 }finally{for(const server of servers)server.rpc?.close?.();if(lock){await lock.close();await unlink(join(context.stateDir,'update.lock')).catch(()=>{});}if(!completed&&transaction?.cancel&&!stopping)await transaction.cancel().catch(()=>{});}
}
