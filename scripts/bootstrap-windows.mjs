import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {stageRelease} from './release.mjs';
import {liveInstall,pluginId} from './live-install.mjs';
import {updateInstalled} from './install-update.mjs';
const exec=promisify(execFile),defaultRoot=fileURLToPath(new URL('..',import.meta.url));
const compatible=value=>{const match=/^(\d+)\.(\d+)\.(\d+)$/.exec(value??'');return !!match&&(Number(match[1])>0||Number(match[2])>9||Number(match[2])===9&&Number(match[3])>=3);};

/** PowerShell supplies a downloaded immutable source and verified prerequisites. */
export async function bootstrapWindows({root=defaultRoot,herdrBin='herdr.exe',session,revision,ref='main',inspectorOnly=false,
 nodeBin=process.execPath,env=process.env,platform=process.platform,arch=process.arch,
 run,stage=stageRelease,install=liveInstall,update=updateInstalled}={}){
 if(platform!=='win32'||arch!=='x64')throw Error('This installer supports Windows x64 only');
 if(session!==undefined&&(!/^[A-Za-z0-9_.-]{1,128}$/.test(session)||session.startsWith('-')))throw Error('Invalid Herdr session name');
 const invoke=run??(async args=>(await exec(herdrBin,[...(args[0]==='--version'||!session?[]:['--session',session]),...args],{env,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024})).stdout);
 const version=(await invoke(['--version'])).trim().match(/^herdr (\d+\.\d+\.\d+)(?:\s|$)/)?.[1];
 if(!compatible(version))throw Error('Herdr version >=0.9.3 is required');
 const status=JSON.parse(await invoke(['status','server','--json']));
 if(!status.running)throw Error('Selected Herdr session is not running. Start Herdr and rerun the installer.');
 if(!compatible(status.version)||status.protocol!==22)throw Error('Running Herdr >=0.9.3 with protocol 22 is required');
 const listing=JSON.parse(await invoke(['plugin','list','--plugin',pluginId,'--json']));
 if(listing.result?.type!=='plugin_list'||!Array.isArray(listing.result.plugins))throw Error('Unrecognized plugin registration response');
 const existing=listing.result.plugins.find(item=>item.plugin_id===pluginId),temp=await mkdtemp(join(tmpdir(),'prism-bootstrap-'));
 try{
  const release=join(temp,'release');
  await stage({root,output:release,platforms:['win32-x64'],nodeBin,helperSource:'bin'});
  return existing
   ?await update({root,release,info:existing,herdrBin,session,env,revision,ref,nodeBin,timeoutMs:60000})
   :await install({root:release,herdrBin,session,env,inspectorOnly,shortcut:true,timeoutMs:60000});
 }finally{await rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const options={};
  for(let i=2;i<process.argv.length;i++){
   const arg=process.argv[i];if(arg==='--inspector-only')options.inspectorOnly=true;
   else if(['--root','--herdr-bin','--session','--revision','--ref'].includes(arg)&&process.argv[i+1])options[{'--herdr-bin':'herdrBin','--root':'root','--session':'session','--revision':'revision','--ref':'ref'}[arg]]=process.argv[++i];
   else throw Error('Unknown or incomplete installer option: '+arg);
  }
  const result=await bootstrapWindows(options);
  console.log(result.updated?`Prism: updated to ${result.version??'the reviewed version'}. Private state, panels, widths and focus preserved.`:'Prism: active in the selected Herdr session. Open: Ctrl+B, then i.');
  if(result.cleanupPending)console.warn(`Prism: code backup cleanup remains pending; recovery metadata: ${result.recoveryJournal??join(result.stateDir,'update-recovery.json')}. Retained code backup: ${result.recovery?.backup??'see recovery metadata'}.`);
  if(result.uninstallCommand)console.log('Complete removal: & '+result.uninstallCommand.map(value=>"'"+String(value).replaceAll("'","''")+"'").join(' '));
 }catch(error){console.error('Prism: '+error.message);process.exitCode=1;}
}
