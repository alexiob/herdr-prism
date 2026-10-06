import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,lstat,readFile,writeFile,rename,readdir,copyFile,rm,realpath,open,unlink} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {homedir} from 'node:os';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {checkInstall,checkedRead} from './check-install.mjs';
const exec=promisify(execFile);
export const pluginId='iob.herdr-prism';
const receiptName='.hat-managed-install.json',requestName='.hat-lifecycle-request.json',resultName='.hat-lifecycle-result.json',ownerName='.hat-lifecycle-owner.json';
const defaultRoot=fileURLToPath(new URL('..',import.meta.url));
const validUuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
function sameSecret(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function nested(parent,child){const rel=relative(parent,child);return rel===''||!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'));}
async function json(root,file){return JSON.parse(await checkedRead(root,file,1024*1024));}
async function privateHelpers(root){return import(pathToFileURL(join(root,'dist/config/safe-file.js')).href);}
async function put(root,name,value){const {atomicWrite}=await privateHelpers(root);await atomicWrite(join(root,name),JSON.stringify(value,null,2)+'\n');}
async function directory(path){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink()||process.platform!=='win32'&&info.uid!==process.getuid())throw new Error(`Refusing unowned/symlink installation directory: ${path}`);return realpath(path);}
async function readReceipt(managedDir){const root=await directory(resolve(managedDir));const receipt=await json(root,receiptName);if(receipt.version!==1||receipt.pluginId!==pluginId||!validUuid(receipt.token)||typeof receipt.installRoot!=='string'||resolve(receipt.installRoot)!==root||typeof receipt.sourceRoot!=='string')throw new Error('Invalid managed installation ownership receipt');return {root,receipt};}
// Action deadlines start after CLI invocation returns. A short acknowledgement
// deadline must not kill an otherwise healthy CLI during subprocess startup.
function cliOptions(options){return {binary:options.herdrBin??process.env.HERDR_BIN_PATH??'herdr',prefix:options.herdrPrefix??(options.session?['--session',options.session]:[]),timeout:Math.max(5000,options.timeoutMs??30000)};}
async function herdr(options,args){const cli=cliOptions(options);try{return await exec(cli.binary,[...cli.prefix,...args],{encoding:'utf8',windowsHide:true,timeout:cli.timeout,maxBuffer:2*1024*1024,env:{...process.env,...options.env}});}catch(error){if(error.killed&&error.code!=='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')throw new Error(`Herdr CLI command timed out after ${cli.timeout} ms: ${args.slice(0,4).join(' ')}`,{cause:error});throw error;}}
async function registration(options){const response=await herdr(options,['plugin','list','--plugin',pluginId,'--json']);const data=JSON.parse(response.stdout);const plugins=data?.result?.type==='plugin_list'?data.result.plugins:undefined;if(!Array.isArray(plugins))throw new Error('Unrecognized Herdr plugin list JSON; refusing lifecycle changes');const candidates=plugins.filter(item=>item&&item.plugin_id===pluginId);if(candidates.length>1)throw new Error('Ambiguous duplicate plugin registration');return candidates[0];}
function registrationRoot(info){return info.plugin_root;}
async function copyManaged(source,target){const entry=await lstat(source);if(entry.isSymbolicLink())throw new Error('Release contains a symlink; refusing managed installation');if(entry.isDirectory()){await mkdir(target,{recursive:true,mode:0o700});for(const name of await readdir(source))await copyManaged(join(source,name),join(target,name));}else if(entry.isFile()){await mkdir(dirname(target),{recursive:true,mode:0o700});await copyFile(source,target);}else throw new Error('Release contains a non-regular file');}
async function withLock(root,operation){const path=join(root,'.hat-wrapper.lock');const handle=await open(path,'wx',0o600).catch(error=>{if(error.code==='EEXIST')throw new Error('Another lifecycle operation owns this managed installation');throw error;});try{return await operation();}finally{await handle.close();await unlink(path).catch(()=>{});}}
async function waitAck(root,receipt,request,timeout){const deadline=Date.now()+timeout;while(Date.now()<deadline){try{const result=await json(root,resultName);if(result.requestId!==request.requestId){await delay(25);continue;}if(result.version!==1||result.pluginId!==pluginId||result.operation!==request.operation||!sameSecret(result.token,receipt.token))throw new Error('Lifecycle acknowledgement authentication failed');if(result.ok!==true)throw new Error(`Live ${request.operation} failed: ${String(result.error??'unknown error')}`);if(!result.result||typeof result.result!=='object')throw new Error('Invalid lifecycle action result');return result.result;}catch(error){if(error.code!=='ENOENT')throw error;}await delay(25);}throw new Error(`Live ${request.operation} timed out waiting for authenticated completion; managed installation retained at ${root}`);}
async function waitAction(options,logId,operation){const deadline=Date.now()+(options.timeoutMs??30000);while(Date.now()<deadline){const response=JSON.parse((await herdr(options,['plugin','log','list','--plugin',pluginId,'--limit','256'])).stdout);if(response.result?.type!=='plugin_log_list'||!Array.isArray(response.result.logs))throw new Error('Invalid Herdr action completion log response');const log=response.result.logs.find(item=>item.log_id===logId&&item.plugin_id===pluginId);if(log?.status==='failed')throw new Error(`Herdr ${operation} action failed: ${log.error??'exit '+log.exit_code}`);if(log?.status==='succeeded'){if(log.exit_code!==0)throw new Error('Herdr action did not report successful exit');return;}await delay(50);}throw new Error(`Herdr ${operation} action timed out before it finished; registration and owned state retained`);}
async function invoke(root,receipt,options,operation,mode){
 const request={version:1,pluginId,token:receipt.token,requestId:randomUUID(),operation,mode,...(operation==='activate'&&options.shortcut?{shortcut:true}:{})};await put(root,requestName,request);
 const response=JSON.parse((await herdr(options,['plugin','action','invoke',operation==='deactivate'?'deactivate':mode==='inspector-only'?'activate-inspector':mode==='own-native'?'activate-overview':'activate','--plugin',pluginId])).stdout);
 const log=response.result?.type==='plugin_action_invoked'?response.result.log:undefined;if(!log||typeof log.log_id!=='string'||log.plugin_id!==pluginId)throw new Error('Herdr did not return a lifecycle action log identity');
 const result=await waitAck(root,receipt,request,options.timeoutMs??30000);await waitAction(options,log.log_id,operation);return result;
}
function proveResult(result,operation){if(result[operation==='activate'?'activated':'deactivated']!==true||typeof result.configDir!=='string'||typeof result.stateDir!=='string'||!Array.isArray(result.conflicts))throw new Error('Incomplete lifecycle completion result');if(result.conflicts.length)throw new Error('Configuration conflicts prevent complete removal: '+result.conflicts.join(', '));}
async function proveDirectory(path,root,receipt){const resolved=await directory(resolve(path));if(resolved===root||resolved===resolve(receipt.sourceRoot)||resolved===resolve(homedir())||resolved===dirname(resolved)||nested(resolved,root)||nested(resolved,resolve(receipt.sourceRoot)))throw new Error(`Refusing unsafe purge directory: ${resolved}`);const marker=await json(resolved,ownerName).catch(error=>{throw new Error(`Plugin ownership marker missing/invalid for ${resolved}: ${error.message}`);});if(marker.version!==1||marker.pluginId!==pluginId||!sameSecret(marker.token,receipt.token)||typeof marker.installRoot!=='string'||resolve(marker.installRoot)!==root)throw new Error(`Plugin ownership mismatch for purge directory: ${resolved}`);return resolved;}
export async function liveInstall(options={}){
 const source=await realpath(resolve(options.root??defaultRoot));const index=await json(source,'checksums.json').catch(error=>{throw new Error('A checksummed release directory is required: '+error.message);});await json(source,'release.json').catch(error=>{throw new Error('A checksummed release descriptor is required: '+error.message);});const checked=await checkInstall({root:source,platform:options.platform,arch:options.arch});if(!checked.ok)throw new Error('Installation prerequisites failed: '+checked.errors.join('; '));
 if(await registration(options))throw new Error('Plugin already registered; uninstall its managed installation before installing a new one');
 const base=process.platform==='win32'?(process.env.LOCALAPPDATA??process.env.APPDATA??homedir()):(process.env.XDG_DATA_HOME??join(homedir(),'.local','share'));
 const requested=resolve(options.managedDir??join(base,'herdr-prism','installs',randomUUID()));if(nested(source,requested)||nested(requested,source))throw new Error('Managed installation must be separate from the source checkout');
 try{await lstat(requested);throw new Error('Managed installation destination already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
 await mkdir(dirname(requested),{recursive:true,mode:0o700});const parent=await realpath(dirname(requested));const root=join(parent,requested.slice(dirname(requested).length+1));if(nested(source,root)||nested(root,source))throw new Error('Managed installation must be separate from source checkout');await mkdir(root,{mode:0o700});
 let linked=false;
 try{
  const {restrict}=await privateHelpers(source);await restrict(root,true);
  for(const file of Object.keys(index.files))await copyManaged(join(source,file),join(root,file));await copyManaged(join(source,'checksums.json'),join(root,'checksums.json'));
  const copied=await checkInstall({root,platform:options.platform,arch:options.arch});if(!copied.ok)throw new Error('Copied release integrity failed: '+copied.errors.join('; '));
  if(!(await lstat(join(root,'scripts/live-install.mjs')).catch(()=>undefined)))throw new Error('Reviewed release omits the live lifecycle wrapper');
  const receipt={version:1,pluginId,token:randomUUID(),installRoot:root,sourceRoot:source,createdAt:Date.now(),phase:'prepared'};await put(root,receiptName,receipt);
  return await withLock(root,async()=>{
   if(await registration(options))throw new Error('Plugin already registered while preparing managed copy; refusing supersession');await herdr(options,['plugin','link',root,'--disabled']);linked=true;receipt.phase='registered';await put(root,receiptName,receipt);
   await herdr(options,['plugin','enable',pluginId]);const mode=options.inspectorOnly?'inspector-only':'own-native';const result=await invoke(root,receipt,options,'activate',mode);proveResult(result,'activate');
   await proveDirectory(result.configDir,root,receipt);await proveDirectory(result.stateDir,root,receipt);receipt.phase='active';receipt.configDir=resolve(result.configDir);receipt.stateDir=resolve(result.stateDir);await put(root,receiptName,receipt);
   return {activated:true,pluginId,managedDir:root,configDir:receipt.configDir,stateDir:receipt.stateDir,mode,...(result.shortcut?{shortcut:result.shortcut}:{}),uninstallCommand:[process.execPath,join(root,'scripts/live-install.mjs'),'uninstall',...(options.herdrBin?['--herdr-bin',options.herdrBin]:[]),...(options.session?['--session',options.session]:[])]};
  });
 }catch(error){if(!linked)await rm(root,{recursive:true,force:true});throw new Error(`${error.message}${linked?`; registration and owned files retained for recovery: ${root}`:''}`);}
}
export async function liveUninstall(options={}){
 const target=resolve(options.managedDir??options.root??defaultRoot);const {root,receipt}=await readReceipt(target);
 return withLock(root,async()=>{
  const info=await registration(options);let result;
  if(info){const registered=registrationRoot(info);if(typeof registered!=='string'||await realpath(registered)!==root)throw new Error('Plugin registration belongs to a foreign installation; refusing removal');result=await invoke(root,receipt,options,'deactivate','remove');proveResult(result,'deactivate');receipt.phase='deactivated';receipt.configDir=resolve(result.configDir);receipt.stateDir=resolve(result.stateDir);await put(root,receiptName,receipt);}
  else {if(receipt.phase!=='deactivated')throw new Error('Plugin is unregistered without authenticated deactivation; lifecycle cleanup cannot be proven');result={configDir:receipt.configDir,stateDir:receipt.stateDir};}
  const dirs=[...new Set([await proveDirectory(result.configDir,root,receipt),await proveDirectory(result.stateDir,root,receipt)])];
  if(info){await herdr(options,['plugin','disable',pluginId]);await herdr(options,['plugin','uninstall',pluginId]);if(await registration(options))throw new Error('Herdr still registers the plugin; owned files retained');}
  // Recheck ownership immediately before each deletion. Never delete a linked source checkout.
  for(const dir of dirs){await proveDirectory(dir,root,receipt);await rm(dir,{recursive:true,force:false});}
  await readReceipt(root);await rm(root,{recursive:true,force:false});return {removed:true,pluginId,managedDir:root,purged:dirs};
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const command=process.argv[2],options={};for(let i=3;i<process.argv.length;i++){const arg=process.argv[i];if(arg==='--own-native')options.ownNative=true;else if(arg==='--inspector-only')options.inspectorOnly=true;else if(['--root','--managed-dir','--herdr-bin','--timeout-ms','--session'].includes(arg)&&process.argv[i+1]){const value=process.argv[++i];options[arg==='--managed-dir'?'managedDir':arg==='--herdr-bin'?'herdrBin':arg==='--timeout-ms'?'timeoutMs':arg==='--session'?'session':'root']=arg==='--timeout-ms'?Number(value):value;}else throw new Error('Unknown or incomplete lifecycle option: '+arg);}
 if(options.session!==undefined&&(!/^[A-Za-z0-9_.-]{1,128}$/.test(options.session)||options.session.startsWith('-')))throw new Error('Invalid Herdr session name');
 if(options.ownNative&&options.inspectorOnly)throw new Error('Choose either native ownership or inspector-only');if(options.timeoutMs!==undefined&&(!Number.isFinite(options.timeoutMs)||options.timeoutMs<100||options.timeoutMs>120000))throw new Error('Timeout must be 100–120000 ms');
 try{console.log(JSON.stringify(await (command==='install'?liveInstall(options):command==='uninstall'?liveUninstall(options):Promise.reject(new Error('Use install or uninstall'))),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
