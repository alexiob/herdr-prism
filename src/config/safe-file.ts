import { chmod, lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
// Fixed readonly script: paths only enter LiteralPath through the environment.
// Return typed data so command, parsing and policy failures remain distinguishable.
const aclInspection="$ErrorActionPreference='Stop'; $p=$env:HAT_PRIVATE_PATH; $s=[System.Security.Principal.WindowsIdentity]::GetCurrent(); $i=Get-Item -LiteralPath $p -Force; $a=Get-Acl -LiteralPath $p; $raw=[System.Security.AccessControl.RawSecurityDescriptor]::new($a.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::All)); [pscustomobject]@{userSid=$s.User.Value; ownerSid=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; tokenOwnerSid=$s.Owner.Value; reparse=[bool](($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0); allowSids=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | Where-Object {$_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow} | ForEach-Object {$_.IdentityReference.Value}); nullDacl=[object]::ReferenceEquals($raw.DiscretionaryAcl,$null); protected=[bool]$a.AreAccessRulesProtected} | ConvertTo-Json -Compress";
export interface WindowsAcl {userSid:string;ownerSid:string;tokenOwnerSid:string;reparse:boolean;allowSids:string[];nullDacl:boolean;protected:boolean;}
const validSid=(value:unknown):value is string=>typeof value==='string'&&/^S-1-(?:\d+-){1,14}\d+$/.test(value);
export function parseWindowsAcl(value:string):WindowsAcl {
 if(value.length>65536)throw new Error('Windows ACL inspection exceeds limit');
 let acl:any;try{acl=JSON.parse(value.replace(/^\ufeff/,''));}catch{throw new Error('Invalid Windows ACL inspection JSON');}
 if(!acl||typeof acl!=='object'||Array.isArray(acl)||!validSid(acl.userSid)||!validSid(acl.ownerSid)||!validSid(acl.tokenOwnerSid)||typeof acl.reparse!=='boolean'||typeof acl.nullDacl!=='boolean'||typeof acl.protected!=='boolean'||!Array.isArray(acl.allowSids)||acl.allowSids.length>4096||acl.allowSids.some((sid:unknown)=>!validSid(sid)))throw new Error('Invalid Windows ACL inspection fields or SID');
 return {userSid:acl.userSid,ownerSid:acl.ownerSid,tokenOwnerSid:acl.tokenOwnerSid,reparse:acl.reparse,allowSids:acl.allowSids,nullDacl:acl.nullDacl,protected:acl.protected};
}
export function assertWindowsAcl(acl:WindowsAcl,{strict=false,allowTokenOwner=false}:{strict?:boolean;allowTokenOwner?:boolean}={}) {
 if(acl.reparse)throw new Error('Reparse point refused');
 // A proven new artifact can initially inherit the creator token's default owner
 // (e.g. Administrators under elevation). Never use this exception for a generic
 // existing path, and require exact user SID ownership after normalization.
 if(acl.ownerSid!==acl.userSid&&(strict||!allowTokenOwner||acl.ownerSid!==acl.tokenOwnerSid))throw new Error(`Owner is not current user (actual ${acl.ownerSid}, expected ${acl.userSid})`);
 if(strict&&acl.nullDacl)throw new Error('Unsafe null DACL');
 if(strict&&!acl.protected)throw new Error('DACL inheritance is not protected');
 if(strict&&acl.allowSids.some(sid=>sid!==acl.userSid))throw new Error('Foreign allow ACL');
}
export function windowsAclCommands(path:string,sid:string,directory:boolean):string[][] {
 if(!validSid(sid))throw new Error('Invalid current user SID');
 // /setowner and DACL modification are separate documented icacls modes.
 return [[path,'/setowner','*'+sid],[path,'/inheritance:r','/grant:r',`*${sid}:${directory?'(OI)(CI)':''}F`]];
}
export async function readWindowsAcl(path:string):Promise<WindowsAcl>{const result=await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(aclInspection,'utf16le').toString('base64')],{windowsHide:true,timeout:15000,maxBuffer:65536,encoding:'utf8',env:{...process.env,HAT_PRIVATE_PATH:path}});return parseWindowsAcl(result.stdout);}
async function ownedPath(path:string,allowTokenOwner=false){const info=await lstat(path);if(info.isSymbolicLink())throw new Error('Refusing symlink state path');if(process.platform==='win32')assertWindowsAcl(await readWindowsAcl(path),{allowTokenOwner});else if(info.uid!==process.getuid?.())throw new Error('Refusing unowned state path');return info;}
export async function restrict(path:string,created=true){
 const info=await lstat(path);if(info.isSymbolicLink())throw new Error('Refusing symlink state path');
 if(process.platform!=='win32'){if(info.uid!==process.getuid?.())throw new Error('Refusing unowned state path');await chmod(path,info.isDirectory()?0o700:0o600);return;}
 // No paths or identities enter PowerShell syntax. Existing directories are verified,
 // never stripped of foreign ACLs. Only newly created plugin artifacts get an ACL.
 let stage='ownership inspection';try{
  // Verify the actual owner before any ACL mutation; never acquire a foreign path.
  const acl=await readWindowsAcl(path);assertWindowsAcl(acl,{allowTokenOwner:created});
  if(created){for(const args of windowsAclCommands(path,acl.userSid,info.isDirectory())){stage=args[1]==='/setowner'?'owner normalization':'DACL restriction';await exec('icacls.exe',args,{windowsHide:true,timeout:5000,maxBuffer:65536});}}
  // Verification only; immutable script and environment path avoid shell interpolation.
  stage='private ACL verification';assertWindowsAcl(await readWindowsAcl(path),{strict:true});
 }
 catch(error){const detail=(error as any).killed?'Windows command timed out':String((error as any).stderr|| (error as Error).message).trim().slice(0,1200);throw new Error(`Cannot ensure current-user-only Windows ACL (${stage}: ${detail}); use a new plugin-owned state directory or secure its ACL explicitly`,{cause:error});}
}
export async function privateDir(path:string){const created=await mkdir(path,{recursive:true,mode:0o700});await restrict(path,created!==undefined);}
export const ensurePrivateDir=privateDir;
/** Herdr activation authorizes only this plugin's exact environment namespaces,
 * for both ordinary GitHub installs and managed installs. A managed receipt is
 * not required for these Herdr-created directories. Generic privateDir remains
 * verification-only on existing directories. Check both before changing either. */
export async function securePluginNamespace(configDir:string,stateDir:string):Promise<void>{
 if(process.env.HERDR_PLUGIN_ID!=='iob.herdr-prism')throw new Error('Refusing untrusted Herdr plugin identity');
 const expected=[process.env.HERDR_PLUGIN_CONFIG_DIR,process.env.HERDR_PLUGIN_STATE_DIR];
 const paths=[configDir,stateDir];
 for(let i=0;i<paths.length;i++){
  if(!expected[i])throw new Error('Missing trusted Herdr plugin namespace');
  // Plugin activation explicitly authorizes only these exact Herdr namespaces.
  // Their creator may be elevated, using the token's default owner SID. Both
  // namespaces are inspected before either one is normalized to the user SID.
  // Inspect both leaf spellings before canonicalization: passing a real target
  // must not conceal a junction in the trusted environment path itself.
  const spellings=paths[i]===expected[i]?[paths[i]]:[expected[i]!,paths[i]];
  for(const spelling of spellings){const info=await ownedPath(spelling,true);if(!info.isDirectory())throw new Error('Herdr plugin namespace must be a directory');}
  if(await realpath(paths[i])!==await realpath(expected[i]!))throw new Error('Refusing mismatched Herdr plugin namespace');
 }
 for(const path of paths)await restrict(path,true);
}
export async function readOptional(path:string){try{const info=await lstat(path);if(info.isSymbolicLink()||!info.isFile())throw new Error('Refusing non-regular config/state file');if(info.size>2*1024*1024)throw new Error('File exceeds 2 MiB limit');return await readFile(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return '';throw error;}}
export async function atomicWrite(path:string,body:string,mode=0o600,beforeRename?:()=>Promise<void>){const tmp=join(dirname(path),'.hat-'+randomBytes(12).toString('hex')+'.tmp');const handle=await open(tmp,'wx',mode);try{await handle.writeFile(body);await handle.sync();await handle.close();if(process.platform==='win32')await restrict(tmp);await beforeRename?.();await rename(tmp,path);try{const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}}catch(error){if(process.platform!=='win32')throw error;}}catch(error){await handle.close().catch(()=>{});await unlink(tmp).catch(()=>{});throw error;}}
