import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {access,chmod,copyFile,lstat,mkdir,mkdtemp,readFile,realpath,rm,rmdir,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname,resolve,isAbsolute} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {stageRelease} from './release.mjs';
import {liveInstall,pluginId} from './live-install.mjs';
import {updateInstalled} from './install-update.mjs';

const exec=promisify(execFile),rootDefault=fileURLToPath(new URL('..',import.meta.url));
const herdrVersion='0.9.3';
// Official v0.9.3 digests, from https://herdr.dev/latest.json (2026-10-06).
const herdrAssets={
 'darwin-arm64':['macos-aarch64','5173a3e0ae42d5d1ab7ebfa5d5e6329f7c3d23f8e1a3677c7ce3231da2884157'],
 'darwin-x64':['macos-x86_64','db62d548ff3e832b087a96b1894a08d26be3905f1830309cd556783f215d4054'],
 'linux-arm64':['linux-aarch64','4de7aa3e25678812e92960de64f7c2aaa1bca1f0f80a3c5e559837e231e1f5c0'],
 'linux-x64':['linux-x86_64','18a8dc65f1c2fa485884344356dea1cfd911c6f06cf46fa78e193f4087f4dba7']
};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const atLeast=(value,wanted)=>{const match=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);if(!match)return false;const parts=match.slice(1).map(Number);for(let i=0;i<3;i++){if(parts[i]!==wanted[i])return parts[i]>wanted[i];}return true;};
async function ownedDirectory(path){
 const info=await lstat(path);
 if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid()||(info.mode&0o022))throw new Error(`Refusing unsafe dependency directory: ${path}`);
}
async function downloadFile(url,path){await exec('curl',['-fsSL','--retry','3','--connect-timeout','10','--max-time','120',url,'-o',path],{timeout:150000,maxBuffer:65536,stdin:'ignore'});}

/** Only checksum-pinned official binaries; never overwrites an existing directory. */
export async function downloadHerdr({directory,platform=process.platform,arch=process.arch,download=downloadFile}){
 const asset=herdrAssets[`${platform}-${arch}`];if(!asset)throw new Error('Unsupported Unix Herdr architecture');
 directory=resolve(directory);const binary=join(directory,'herdr');
 let exists=true;try{await lstat(directory);}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}
 if(exists){
  await ownedDirectory(directory);const info=await lstat(binary);
  if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid()||digest(await readFile(binary))!==asset[1])throw new Error('Existing Herdr runtime checksum differs; refusing replacement');
  return binary;
 }
 await mkdir(dirname(directory),{recursive:true,mode:0o700});await ownedDirectory(dirname(directory));
 const stage=await mkdtemp(join(dirname(directory),'.prism-herdr-'));let created=false,copied=false;
 try{
  const candidate=join(stage,'herdr');
  await download(`https://github.com/herdrdev/herdr/releases/download/v${herdrVersion}/herdr-${asset[0]}`,candidate);
  const info=await lstat(candidate);
  if(!info.isFile()||info.isSymbolicLink()||info.size>128*1024*1024||digest(await readFile(candidate))!==asset[1])throw new Error('Herdr download checksum mismatch; nothing was installed');
  await mkdir(directory,{mode:0o700});created=true;
  await copyFile(candidate,binary,constants.COPYFILE_EXCL);copied=true;await chmod(binary,0o755);return binary;
 }catch(error){if(copied)await unlink(binary).catch(()=>{});if(created)await rmdir(directory).catch(()=>{});throw error;}
 finally{await rm(stage,{recursive:true,force:true});}
}
async function findExecutable(name,env){
 if(name.includes('/')){const path=resolve(name);await access(path,constants.X_OK);return realpath(path);}
 for(const directory of (env.PATH??'').split(':')){try{const path=join(directory||'.',name);await access(path,constants.X_OK);const info=await lstat(path);if(info.isFile()||info.isSymbolicLink())return realpath(path);}catch{}}
}
async function cli(binary,session,args,env){
 return exec(binary,[...(session?['--session',session]:[]),...args],{env,timeout:30000,maxBuffer:2*1024*1024,encoding:'utf8'});
}
async function status(binary,session,env){
 let output;try{output=(await cli(binary,session,['status','server','--json'],env)).stdout;}
 catch(error){if(!error.stdout)throw error;output=error.stdout;}
 const result=JSON.parse(output);if(typeof result.running!=='boolean')throw new Error('Unrecognized Herdr server status; refusing installation');return result;
}
async function startServer({herdrBin,session,env}){
 const child=spawn(herdrBin,[...(session?['--session',session]:[]),'server'],{env,detached:true,stdio:'ignore'});
 await new Promise((accept,reject)=>{child.once('spawn',accept);child.once('error',reject);});child.unref();
 try{
  for(let attempt=0;attempt<75;attempt++){
   if(child.exitCode!==null&&child.exitCode!==0)throw new Error('New Herdr server exited before readiness');
   try{if((await status(herdrBin,session,env)).running)return;}catch{}
   await delay(200);
  }
  throw new Error('New Herdr server did not report readiness');
 }catch(error){if(child.exitCode===null)child.kill('SIGTERM');throw error;}
}

/** The caller has supplied a reviewed source tree. Downloads need no npm/toolchain. */
export async function bootstrapUnix({root=rootDefault,herdrBin,session,prepareOnly=false,noStart=false,inspectorOnly=false,
 dependencyDir=join(process.env.XDG_DATA_HOME??join(homedir(),'.local','share'),'herdr-prism','dependencies'),
 env=process.env,install=liveInstall,update=updateInstalled,start=startServer,download=downloadFile,
 revision=env.PRISM_INSTALL_REVISION,ref='main'}={}){
 const target=`${process.platform}-${process.arch}`;
 if(!herdrAssets[target])throw new Error('This bootstrap supports macOS/Linux x64 and arm64 only');
 if(!atLeast(process.versions.node,[22,13,0]))throw new Error('Node >=22.13.0 is required');
 if(session!==undefined&&(!/^[A-Za-z0-9_.-]{1,128}$/.test(session)||session.startsWith('-')))throw new Error('Invalid Herdr session name');
 herdrBin=await findExecutable(herdrBin??env.HERDR_BIN_PATH??'herdr',env);
 if(!herdrBin)herdrBin=await downloadHerdr({directory:join(dependencyDir,`herdr-v${herdrVersion}-${target}`),download});
 const version=(await cli(herdrBin,undefined,['--version'],env)).stdout.trim();
 if(!/^herdr (\d+\.\d+\.\d+)(?:\s|$)/.test(version))throw new Error('Cannot determine installed Herdr version');
 // A running old installation must be upgraded intentionally; never switch its daemon.
 if(!atLeast(version.split(' ')[1],[0,9,3]))throw new Error('Herdr >=0.9.3 is required; upgrade and restart the running server before installing Prism');
 if(prepareOnly)return {prepared:true,herdrBin,nodeBin:process.execPath};
 let server=await status(herdrBin,session,env),startedServer=false;
 if(!server.running){
  if(noStart)throw new Error('Selected Herdr session is not running; start Herdr and rerun the installer');
  await start({herdrBin,session,env});startedServer=true;server=await status(herdrBin,session,env);
 }
 if(!server.running||!atLeast(server.version,[0,9,3])||server.protocol!==22)throw new Error('Running Herdr >=0.9.3 with protocol 22 is required; upgrade/restart it before installing Prism');
 if(startedServer){
  const snapshot=JSON.parse((await cli(herdrBin,session,['api','snapshot'],env)).stdout).result?.snapshot;
  if(!snapshot||!Array.isArray(snapshot.panes))throw new Error('Cannot inspect the newly started Herdr session');
  if(!snapshot.panes.length)await cli(herdrBin,session,['workspace','create','--cwd',process.cwd(),'--focus'],env);
 }
 const listing=JSON.parse((await cli(herdrBin,session,['plugin','list','--plugin',pluginId,'--json'],env)).stdout);
 if(listing.result?.type!=='plugin_list'||!Array.isArray(listing.result.plugins))throw new Error('Unrecognized plugin registration response');
 const existing=listing.result.plugins.find(item=>item.plugin_id===pluginId);
 const temp=await mkdtemp(join(tmpdir(),'prism-bootstrap-'));
 try{
  const release=join(temp,'release');
  await stageRelease({root,output:release,platforms:[target],nodeBin:process.execPath,helperSource:'bin'});
  const result=existing
   ?await update({root,release,info:existing,herdrBin,session,env,revision,ref,nodeBin:process.execPath,timeoutMs:60000})
   :await install({root:release,herdrBin,session,env,inspectorOnly,shortcut:true,timeoutMs:60000});
  return {...result,herdrBin,nodeBin:process.execPath,startedServer};
 }finally{await rm(temp,{recursive:true,force:true});}
}
const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};
 try{
  for(let i=2;i<process.argv.length;i++){
   const arg=process.argv[i];
   if(['--prepare-only','--no-start','--inspector-only'].includes(arg))options[{'--prepare-only':'prepareOnly','--no-start':'noStart','--inspector-only':'inspectorOnly'}[arg]]=true;
   else if(['--source-dir','--herdr-bin','--session','--node-bin','--ref'].includes(arg)&&process.argv[i+1]){
    const value=process.argv[++i];if(arg==='--source-dir')options.root=value;else if(arg==='--herdr-bin')options.herdrBin=value;else if(arg==='--session')options.session=value;else if(arg==='--ref')options.ref=value;
   }else throw new Error('Unknown or incomplete installer option: '+arg);
  }
  const result=await bootstrapUnix(options);
  if(result.prepared)console.log(`Prism: prerequisites ready. Herdr: ${quote(result.herdrBin)}; Node: ${quote(result.nodeBin)}`);
  else if(result.updated){
   console.log(`Prism: updated to ${result.version??'the reviewed version'}. Private state, panel visibility, widths and focus preserved.`);
   if(result.cleanupPending)console.warn(`Prism: code backup cleanup remains pending; recovery metadata: ${result.recoveryJournal??join(result.stateDir,'update-recovery.json')}. Retained code backup: ${result.recovery?.backup??'see recovery metadata'}.`);
  }
  else {
   console.log('Prism: active in the selected Herdr session.');
   console.log(result.shortcut==='conflict'?'Prism: prefix+i is already assigned or uses unsupported syntax; existing binding preserved. Open from the Prism action menu.':'Open Prism: Ctrl+B, then i (or your configured Herdr prefix, then i). Close the focused panel: q.');
   if(result.startedServer)console.log(`Attach with: ${quote(result.herdrBin)}${options.session?' --session '+quote(options.session):''}`);
   console.log('Complete Prism removal: '+result.uninstallCommand.map(quote).join(' '));
  }
 }catch(error){console.error('Prism: '+error.message);process.exitCode=1;}
}
