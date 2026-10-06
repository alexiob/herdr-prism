import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const exec=promisify(execFile),windows={skip:process.platform!=='win32'};
const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'";
const library=resolve('scripts/install-windows.ps1');
async function run(body:string){return exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from("$ErrorActionPreference='Stop'; . "+literal(library)+"; "+body,'utf16le').toString('base64')],{windowsHide:true,timeout:15000});}

test('Windows bootstrap enforces Node minimum and rejects malformed versions',windows,async()=>{
 const result=await run("@('v22.12.9','v22.13.0','v24.21.0','garbage','v24.0.0-beta') | ForEach-Object { Test-PrismNodeVersion $_ }");
 assert.deepEqual(result.stdout.trim().split(/\r?\n/),['False','True','True','False','False']);
});

test('Windows bootstrap rejects a tampered archive without installing or changing the original',windows,async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-installer-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const archive=join(root,'node.zip'),destination=join(root,'runtime');await writeFile(archive,'tampered');
 const result=await run("try { Install-PrismNodeRuntime -Directory "+literal(destination)+" -ArchivePath "+literal(archive)+"; throw 'unexpected success' } catch { if ($_.Exception.Message -notmatch 'archive checksum mismatch') { throw }; Write-Output 'rejected' }");
 assert.equal(result.stdout.trim(),'rejected');await assert.rejects(lstat(destination),{code:'ENOENT'});assert.equal((await lstat(archive)).size,8);
});

test('Windows bootstrap refuses to overwrite an existing managed runtime with a different binary',windows,async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-installer-existing-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(join(root,'node.exe'),'original');
 const result=await run("try { Install-PrismNodeRuntime -Directory "+literal(root)+"; throw 'unexpected success' } catch { if ($_.Exception.Message -notmatch 'refusing replacement') { throw }; Write-Output 'preserved' }");
 assert.equal(result.stdout.trim(),'preserved');assert.equal((await lstat(join(root,'node.exe'))).size,8);
});
