import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm,lstat,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const exec=promisify(execFile),windows={skip:process.platform!=='win32'};
const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'";
const library=resolve('scripts/install-windows.ps1');
async function run(body:string){return exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from("$ErrorActionPreference='Stop'; . "+literal(library)+"; "+body,'utf16le').toString('base64')],{windowsHide:true,timeout:15000});}

test('Windows shortcut preserves config bytes and ACL, creates backup and is idempotent',windows,async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-shortcut-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const config=join(root,'config.toml'),original='\ufeff# keep me\r\n[keys]\r\nprevious_tab = "prefix+p"\r\n';await writeFile(config,original);
 const call='Set-PrismShortcut -ConfigPath '+literal(config)+' -NodeExe '+literal(process.execPath)+' -PluginRoot '+literal(resolve('.'));
 await run('$before=(Get-Acl -LiteralPath '+literal(config)+').Sddl; '+call+'; '+call+'; if ((Get-Acl -LiteralPath '+literal(config)+').Sddl -ne $before) { throw "ACL changed" }');
 const after=await readFile(config,'utf8');assert.ok(after.startsWith(original));assert.equal(after.match(/key = "prefix\+i"/g)?.length,1);assert.equal(await readFile(config+'.prism-shortcut.bak','utf8'),original);
});

test('Windows shortcut preserves conflicting custom and built-in bindings',windows,async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-shortcut-conflict-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const original of ['[keys]\nsettings = "prefix+i"\n','[[keys.command]]\nkey = "prefix+i"\ntype = "shell"\ncommand = "echo hello"\n','[[keys.command]]\nkey = "prefix+\\U00000069"\ntype = "shell"\ncommand = "echo hello"\n','[[keys.command]]\nkey = """prefix+i"""\ntype = "shell"\ncommand = "echo hello"\n',"[[keys.command]]\nkey = '''prefix+i'''\ntype = 'shell'\ncommand = 'echo hello'\n"]){
  const config=join(root,'config.toml');await writeFile(config,original);
  await run('Set-PrismShortcut -ConfigPath '+literal(config)+' -NodeExe '+literal(process.execPath)+' -PluginRoot '+literal(resolve('.')));
  assert.equal(await readFile(config,'utf8'),original);
 }
});

test('Windows shortcut supports config larger than the Windows environment variable limit',windows,async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-shortcut-large-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const config=join(root,'config.toml'),original='#'+'a'.repeat(40000)+'\n';await writeFile(config,original);
 await run('Set-PrismShortcut -ConfigPath '+literal(config)+' -NodeExe '+literal(process.execPath)+' -PluginRoot '+literal(resolve('.')));
 assert.ok((await readFile(config,'utf8')).startsWith(original));assert.match(await readFile(config,'utf8'),/key = "prefix\+i"/);
});

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
