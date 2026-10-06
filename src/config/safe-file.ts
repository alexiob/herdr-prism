import { chmod, lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
// Fixed script: neither paths nor identities are interpreted as PowerShell code.
const aclInspection="$ErrorActionPreference='Stop'; $p=$env:HAT_PRIVATE_PATH; $s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $i=Get-Item -LiteralPath $p -Force; if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse point refused'}; $a=Get-Acl -LiteralPath $p; if($a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $s.Value){throw 'Owner is not current user'}; if($env:HAT_PRIVATE_STRICT -eq '1'){foreach($r in $a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -ne $s.Value){throw 'Foreign allow ACL'}}}";
async function inspectWindows(path:string,strict:boolean){await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(aclInspection,'utf16le').toString('base64')],{windowsHide:true,timeout:5000,env:{...process.env,HAT_PRIVATE_PATH:path,HAT_PRIVATE_STRICT:strict?'1':'0'}});}
async function ownedPath(path:string){const info=await lstat(path);if(info.isSymbolicLink())throw new Error('Refusing symlink state path');if(process.platform==='win32')await inspectWindows(path,false);else if(info.uid!==process.getuid?.())throw new Error('Refusing unowned state path');return info;}
export async function restrict(path:string,created=true){
 const info=await lstat(path);if(info.isSymbolicLink())throw new Error('Refusing symlink state path');
 if(process.platform!=='win32'){if(info.uid!==process.getuid?.())throw new Error('Refusing unowned state path');await chmod(path,info.isDirectory()?0o700:0o600);return;}
 // No paths or identities enter PowerShell syntax. Existing directories are verified,
 // never stripped of foreign ACLs. Only newly created plugin artifacts get an ACL.
 try{
  // Verify the actual owner before any ACL mutation; never acquire a foreign path.
  await inspectWindows(path,false);
  if(created){const identity=await exec('whoami.exe',['/user','/fo','csv','/nh'],{windowsHide:true,timeout:5000});const sid=identity.stdout.match(/S-1-(?:\d+-)*\d+/)?.[0];if(!sid)throw new Error('Current user SID unavailable');const rights=info.isDirectory()?`*${sid}:(OI)(CI)F`:`*${sid}:F`;await exec('icacls.exe',[path,'/inheritance:r','/grant:r',rights,'/setowner','*'+sid],{windowsHide:true,timeout:5000});}
  // Verification only; immutable script and environment path avoid shell interpolation.
  await inspectWindows(path,true);
 }
 catch{throw new Error('Cannot ensure current-user-only Windows ACL; use a new plugin-owned state directory or secure its ACL explicitly');}
}
export async function privateDir(path:string){const created=await mkdir(path,{recursive:true,mode:0o700});await restrict(path,created!==undefined);}
export const ensurePrivateDir=privateDir;
/** Dedicated managed-install authorization. Call only after validating the lifecycle
 * request against this runtime's plugin root. Generic privateDir never strips ACLs
 * on existing directories. Both trusted namespaces are checked before either changes. */
export async function securePluginNamespace(configDir:string,stateDir:string):Promise<void>{
 if(process.env.HERDR_PLUGIN_ID!=='iob.herdr-prism')throw new Error('Refusing untrusted Herdr plugin identity');
 const expected=[process.env.HERDR_PLUGIN_CONFIG_DIR,process.env.HERDR_PLUGIN_STATE_DIR];
 const paths=[configDir,stateDir];
 for(let i=0;i<paths.length;i++){
  if(!expected[i])throw new Error('Missing trusted Herdr plugin namespace');
  const info=await ownedPath(paths[i]);if(!info.isDirectory())throw new Error('Herdr plugin namespace must be a directory');
  if(await realpath(paths[i])!==await realpath(expected[i]!))throw new Error('Refusing mismatched Herdr plugin namespace');
 }
 for(const path of paths)await restrict(path,true);
}
export async function readOptional(path:string){try{const info=await lstat(path);if(info.isSymbolicLink()||!info.isFile())throw new Error('Refusing non-regular config/state file');if(info.size>2*1024*1024)throw new Error('File exceeds 2 MiB limit');return await readFile(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return '';throw error;}}
export async function atomicWrite(path:string,body:string,mode=0o600,beforeRename?:()=>Promise<void>){const tmp=join(dirname(path),'.hat-'+randomBytes(12).toString('hex')+'.tmp');const handle=await open(tmp,'wx',mode);try{await handle.writeFile(body);await handle.sync();await handle.close();if(process.platform==='win32')await restrict(tmp);await beforeRename?.();await rename(tmp,path);try{const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}}catch(error){if(process.platform!=='win32')throw error;}}catch(error){await handle.close().catch(()=>{});await unlink(tmp).catch(()=>{});throw error;}}
