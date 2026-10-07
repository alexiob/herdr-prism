import {execFile} from 'node:child_process';
import {promisify,isDeepStrictEqual} from 'node:util';
import net from 'node:net';
import {lstat,realpath,readFile,writeFile,mkdir,readdir,copyFile,chmod,rename,rm,open,unlink} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute,basename,sep} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {checkInstall,checkedRead} from './check-install.mjs';

const exec=promisify(execFile),pluginId='iob.herdr-prism',receiptFile='.hat-managed-install.json';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(root,path)=>{const rel=relative(root,path);return rel===''||!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);};
const owned=stat=>process.platform==='win32'||stat.uid===process.getuid();
async function directory(path){const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||!owned(stat))throw Error('Update requires an owned regular directory; symlink directories are refused');return realpath(path);}
async function regularFile(root,file){
 if(!file||isAbsolute(file)||file.includes('\\')||file.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Unsafe release file path');
 let path=root;for(const [index,part]of file.split('/').entries()){path=join(path,part);const stat=await lstat(path);if(stat.isSymbolicLink()||!owned(stat)||(index===file.split('/').length-1?!stat.isFile():!stat.isDirectory()))throw Error('Release contains an unowned, non-regular or symlink artifact');}
 return join(root,file);
}
async function copyTree(source,target){
 const stat=await lstat(source);if(stat.isSymbolicLink()||!owned(stat))throw Error('Installed code contains an unowned or symlink artifact; refusing update');
 if(stat.isDirectory()){await mkdir(target,{mode:0o700});for(const name of await readdir(source))await copyTree(join(source,name),join(target,name));await chmod(target,stat.mode&0o777);}
 else if(stat.isFile()){await copyFile(source,target);await chmod(target,stat.mode&0o777);}
 else throw Error('Installed code contains a non-regular artifact; refusing update');
}
async function optionalReceipt(root){
 let bytes;try{await regularFile(root,receiptFile);bytes=await checkedRead(root,receiptFile,1024*1024);}catch(error){if(error.code==='ENOENT')return;throw error;}
 let receipt;try{receipt=JSON.parse(bytes);}catch{throw Error('Invalid managed installation ownership receipt');}
 if(receipt.version!==1||receipt.pluginId!==pluginId||typeof receipt.token!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(receipt.token)||typeof receipt.installRoot!=='string'||resolve(receipt.installRoot)!==root||typeof receipt.sourceRoot!=='string'||resolve(receipt.sourceRoot)===root)throw Error('Invalid managed installation ownership receipt');
 for(const field of ['configDir','stateDir'])if(receipt[field]!==undefined){
  if(typeof receipt[field]!=='string'||!isAbsolute(receipt[field]))throw Error('Private config/state ownership paths must be absolute');
  let path=resolve(receipt[field]);try{path=await directory(path);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(inside(root,path)||inside(path,root))throw Error('Private config/state must remain outside the installed code root');
 }
 return {bytes,receipt};
}
async function command(options,args){
 const prefix=options.herdrPrefix??(options.session?['--session',options.session]:[]);
 try{return await exec(options.herdrBin??process.env.HERDR_BIN_PATH??'herdr',[...prefix,...args],{encoding:'utf8',env:{...process.env,...options.env},windowsHide:true,timeout:options.timeoutMs??30000,maxBuffer:2*1024*1024});}
 catch(error){throw Error(error.killed?'Herdr update registration command timed out':'Herdr update registration command failed',{cause:error});}
}
function socketCall(endpoint,method,params,timeout){
 if(process.platform==='win32'&&!/^\\\\[^\\]+\\pipe\\/i.test(endpoint))endpoint='\\\\.\\pipe\\'+endpoint;
 return new Promise((resolve,reject)=>{
  const id='prism-update-'+randomUUID(),socket=net.createConnection(endpoint);let buffer='',settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(result);};
  const timer=setTimeout(()=>finish(Error('Herdr registration RPC timed out; result may be unknown')),timeout);socket.setEncoding('utf8');socket.once('error',error=>finish(error));socket.once('end',()=>finish(Error('Herdr registration RPC closed before acknowledgement')));
  socket.once('connect',()=>socket.write(JSON.stringify({id,method,params})+'\n'));
  socket.on('data',chunk=>{buffer+=chunk;if(Buffer.byteLength(buffer)>2*1024*1024)return finish(Error('Herdr registration response exceeded its limit'));const at=buffer.indexOf('\n');if(at<0)return;let reply;try{reply=JSON.parse(buffer.slice(0,at));}catch{return finish(Error('Malformed Herdr registration response'));}if(reply.id!==id)return finish(Error('Unexpected Herdr registration response identity'));if(reply.error)return finish(Error('Herdr registration rejected the prepared plugin'));if(!reply.result)return finish(Error('Herdr registration response has no result'));finish(undefined,reply.result);});
 });
}
async function transport(options){
 if(options.rpc?.call)return options.rpc;
 // An explicitly selected session takes precedence over an inherited pane's
 // socket override. Let the same CLI resolve its selected session endpoint.
 let endpoint=options.endpoint??(options.session?undefined:options.env?.HERDR_SOCKET_PATH??process.env.HERDR_SOCKET_PATH);
 if(!endpoint){let status;try{status=JSON.parse((await command(options,['status','server','--json'])).stdout);}catch{throw Error('Cannot resolve Herdr registration endpoint; provide endpoint or HERDR_SOCKET_PATH');}endpoint=status.socket??status.server?.socket;}
 if(typeof endpoint!=='string'||!endpoint||/[\x00\r\n]/.test(endpoint))throw Error('Invalid Herdr registration endpoint');
 return {call:(method,params)=>socketCall(endpoint,method,params,options.timeoutMs??30000)};
}
async function registration(rpc){const response=await rpc.call('plugin.list',{plugin_id:pluginId});if(response.type!=='plugin_list'||!Array.isArray(response.plugins)||response.plugins.length!==1||response.plugins[0]?.plugin_id!==pluginId)throw Error('Plugin registration changed or is ambiguous');return response.plugins[0];}
function sameRegistration(expected,current){return current.plugin_id===expected.plugin_id&&resolve(current.plugin_root??'')===resolve(expected.plugin_root)&&isDeepStrictEqual(current.source??{kind:'local'},expected.source??{kind:'local'});}
async function link(rpc,root,source){const response=await rpc.call('plugin.link',{path:root,enabled:false,...(source?{source}:{})});if(response.type!=='plugin_linked'||response.plugin?.plugin_id!==pluginId||resolve(response.plugin.plugin_root??'')!==root||response.plugin.enabled!==false)throw Error('Herdr did not acknowledge the exact prepared plugin registration');if(source?.kind==='github'&&(response.plugin.source?.kind!=='github'||response.plugin.source.resolved_commit!==source.resolved_commit||response.plugin.source.owner!==source.owner||response.plugin.source.repo!==source.repo))throw Error('Herdr did not preserve the reviewed GitHub source');}
async function bindNode(root,index,nodeBin){
 if(nodeBin===undefined)return;
 if(typeof nodeBin!=='string'||!isAbsolute(nodeBin)||/[\x00-\x1f\x7f]/.test(nodeBin))throw Error('Node runtime binding requires an absolute executable path');
 const manifest=await readFile(join(root,'herdr-plugin.toml'),'utf8');let count=0;
 const bound=manifest.replace(/^(command\s*=\s*\[\s*)("(?:[^"\\]|\\.)*")(?=\s*[,\]])/gm,(_,prefix,quoted)=>{
  const executable=JSON.parse(quoted),name=executable.replaceAll('\\','/').split('/').at(-1),absolute=isAbsolute(executable)||/^[A-Za-z]:[\\/]/.test(executable);
  if(executable!=='node'&&!(absolute&&/^(?:node|node\.exe)$/i.test(name)))throw Error('Prepared manifest has an unexpected non-Node command executable');
  count++;return prefix+JSON.stringify(nodeBin);
 });
 if(!count||count!==(manifest.match(/^command\s*=/gm)?.length??0))throw Error('Cannot bind every prepared manifest command to Node');
 await writeFile(join(root,'herdr-plugin.toml'),bound);index.files['herdr-plugin.toml']=digest(Buffer.from(bound));await writeFile(join(root,'checksums.json'),JSON.stringify(index,null,2)+'\n');
}

/** Prepare and verify all copies before the caller deactivates its old collector.
 * State, preferences and ownership markers live outside this code transaction.
 * The updater owns deactivation, enabled state, activation and readiness proof.
 */
export async function prepareCodeReplacement(options={}){
 const {info}=options;if(info?.plugin_id!==pluginId||typeof info.plugin_root!=='string')throw Error('A single Prism installed-plugin registration is required');
 if(typeof options.release!=='string'||!options.release)throw Error('An explicit checksummed staged release directory is required');
 if(options.timeoutMs!==undefined&&(!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<100||options.timeoutMs>120000))throw Error('Update registration timeout must be 100–120000 ms');
 const root=await directory(resolve(info.plugin_root)),release=await directory(resolve(options.release??''));
 if(inside(root,release)||inside(release,root))throw Error('Reviewed release and installed code may not overlap');
 const receipt=await optionalReceipt(root),github=info.source?.kind==='github';
 if(!receipt&&!github)throw Error('Local developer links cannot be updated in place; update the developer checkout explicitly or install a managed release');
 if(github){if(typeof options.revision!=='string'||!/^[a-f0-9]{40}$/.test(options.revision))throw Error('GitHub replacement requires a reviewed immutable 40-character revision');if(!/^[A-Za-z0-9_.-]+$/.test(info.source.owner??'')||!/^[A-Za-z0-9_.-]+$/.test(info.source.repo??'')||typeof info.source.managed_path!=='string'||!inside(await directory(resolve(info.source.managed_path)),root))throw Error('GitHub registration has no safe managed source path');}
 const descriptor=JSON.parse(await checkedRead(release,'release.json',1024*1024)),index=JSON.parse(await checkedRead(release,'checksums.json',1024*1024));
 if(descriptor.version!==1||descriptor.name!=='herdr-prism'||descriptor.protocol!==22||typeof descriptor.releaseVersion!=='string'||index.version!==1||index.algorithm!=='sha256'||!index.files||typeof index.files!=='object'||Array.isArray(index.files)||!index.files['release.json'])throw Error('A checksummed staged Prism release is required');
 for(const file of Object.keys(index.files))await regularFile(release,file);
 const checked=await checkInstall({root:release,platform:options.platform,arch:options.arch});if(!checked.ok)throw Error('Prepared release checksum/prerequisite verification failed: '+checked.errors.join('; '));
 const pkg=JSON.parse(await checkedRead(release,'package.json',1024*1024));if(pkg.version!==descriptor.releaseVersion)throw Error('Prepared release version does not match its descriptor');
 const parent=await directory(dirname(root)),label='.'+basename(root)+'.hat-update-',stage=join(parent,label+randomUUID()+'.stage'),snapshot=join(parent,label+randomUUID()+'.snapshot'),retired=join(parent,label+randomUUID()+'.backup'),discard=join(parent,label+randomUUID()+'.discard');
 const initial=await lstat(root),oldManifest=digest(await readFile(join(root,'herdr-plugin.toml')));
 const lockPath=join(parent,'.'+basename(root)+'.hat-update-lock');let lock;
 try{lock=await open(lockPath,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('Another prepared code update owns this installation');throw error;}
 let rpc,phase='preparing',retiredExists=false;
 const clean=async()=>{for(const path of [stage,snapshot,retired,discard]){try{await directory(path);await rm(path,{recursive:true,force:false,maxRetries:10,retryDelay:100});}catch(error){if(error.code!=='ENOENT')throw error;}}await lock.close();await unlink(lockPath);};
 try{
  await mkdir(stage,{mode:0o700});
  for(const file of Object.keys(index.files)){if(file===receiptFile||file.startsWith('.hat-'))throw Error('Release may not replace installation ownership or lifecycle records');const source=await regularFile(release,file);await mkdir(dirname(join(stage,file)),{recursive:true,mode:0o700});await copyFile(source,join(stage,file));await chmod(join(stage,file),(await lstat(source)).mode&0o777);}
  await copyFile(await regularFile(release,'checksums.json'),join(stage,'checksums.json'));
  await bindNode(stage,index,options.nodeBin);
  if(receipt)await writeFile(join(stage,receiptFile),receipt.bytes,{mode:0o600});
  const copied=await checkInstall({root:stage,platform:options.platform,arch:options.arch});if(!copied.ok)throw Error('Copied prepared release verification failed: '+copied.errors.join('; '));
  await copyTree(root,snapshot);rpc=await transport(options);if(!sameRegistration(info,await registration(rpc)))throw Error('Plugin registration changed while preparing code');phase='prepared';
 }catch(error){await clean().catch(()=>{});throw error;}
 const originalSource=structuredClone(info.source??{kind:'local'}),nextSource=github?{...originalSource,resolved_commit:options.revision,requested_ref:options.ref??options.revision,installed_unix_ms:Date.now()}:originalSource;
 const transaction={root,version:descriptor.releaseVersion,recovery:{backup:retired,prepared:stage,lock:lockPath,snapshot,discard},
  async replace(){
   if(phase!=='prepared')throw Error('Prepared replacement has already been used or cancelled');
   if(!sameRegistration(info,await registration(rpc)))throw Error('Plugin registration changed before code replacement');const current=await lstat(root);
   if(current.isSymbolicLink()||!current.isDirectory()||current.dev!==initial.dev||current.ino!==initial.ino||digest(await readFile(join(root,'herdr-plugin.toml')))!==oldManifest)throw Error('Installed code changed after preparation; refusing replacement');
   if(receipt){const now=await optionalReceipt(root);if(!now||now.receipt.token!==receipt.receipt.token)throw Error('Managed ownership changed after preparation');await writeFile(join(stage,receiptFile),now.bytes,{mode:0o600});}
   phase='replacing';
   try{await rename(root,retired);retiredExists=true;await rename(stage,root);phase='replaced';await link(rpc,root,nextSource);return transaction;}
   catch(error){try{await transaction.rollback();}catch(rollbackError){throw new AggregateError([error,rollbackError],'Code replacement failed and rollback registration could not be completed; retained backup: '+retired);}throw error;}
  },
  async rollback(){
   if(phase==='rolled-back'||phase==='prepared'||phase==='finished')return;
   if(!retiredExists&&phase!=='restored')throw Error('Code rollback has no retained original directory');
   if(phase!=='restored'){
    try{await directory(root);await rename(root,discard);}catch(error){if(error.code!=='ENOENT')throw error;}
    await directory(retired);await rename(retired,root);retiredExists=false;phase='restored';
   }
   await link(rpc,root,originalSource);phase='rolled-back';
  },
  async cancel(){if(phase!=='prepared')throw Error('Only an unused prepared replacement can be cancelled');await clean();phase='finished';},
  async finish(){if(phase==='finished')return;if(!['replaced','rolled-back','prepared'].includes(phase))throw Error('Code transaction still needs rollback; backup retained');await clean();phase='finished';}
 };
 return transaction;
}
/** Convenience for callers that already deactivated the previous generation. */
export async function replacePreparedCode(options){const prepared=await prepareCodeReplacement(options);try{return await prepared.replace();}catch(error){await prepared.finish().catch(()=>{});throw error;}}
