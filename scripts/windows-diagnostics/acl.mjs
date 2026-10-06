import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readWindowsAcl,restrict} from '../../dist/config/safe-file.js';

// Opt-in CI diagnostic. Only this exact newly-created disposable directory is
// modified; inspect the resulting SID/ACL fields, never environment or user files.
if(process.platform!=='win32')throw Error('This diagnostic requires actual Windows');
const output=path.resolve('artifacts/windows-diagnostics');
await mkdir(output,{recursive:true});
const directory=await mkdtemp(path.join(tmpdir(),'prism-acl-diagnostic-'));
const evidence={kind:'actual-Windows-fresh-ACL-diagnostic',platform:process.platform,arch:process.arch,node:process.version};
const inspection="$ErrorActionPreference='Stop'; $a=Get-Acl -LiteralPath $env:PRISM_DIAGNOSTIC_PATH; @($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object {[pscustomobject]@{sid=$_.IdentityReference.Value; accessType=[string]$_.AccessControlType; inherited=$_.IsInherited; inheritance=[string]$_.InheritanceFlags; propagation=[string]$_.PropagationFlags; rights=[string]$_.FileSystemRights}}) | ConvertTo-Json -Compress";
const details=async()=>JSON.parse((await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(inspection,'utf16le').toString('base64')],{windowsHide:true,timeout:15000,maxBuffer:65536,encoding:'utf8',env:{...process.env,PRISM_DIAGNOSTIC_PATH:directory}})).stdout);
try{
 evidence.before=await readWindowsAcl(directory);
 evidence.beforeRules=await details();
 try{await restrict(directory,true);evidence.restrictSucceeded=true;}catch(error){evidence.restrictSucceeded=false;evidence.error=error.message;}
 evidence.after=await readWindowsAcl(directory);
 evidence.afterRules=await details();
 evidence.residualForeignAllows=evidence.after.allowSids.filter(sid=>sid!==evidence.after.userSid);
}catch(error){evidence.error=error.message;process.exitCode=1;}
finally{
 try{await rm(directory,{recursive:true,force:true});evidence.disposableDirectoryRemoved=true;}catch(error){evidence.cleanupError=error.message;process.exitCode=1;}
 await writeFile(path.join(output,'acl.json'),JSON.stringify(evidence,null,2)+'\n');
}
console.log(JSON.stringify(evidence,null,2));
