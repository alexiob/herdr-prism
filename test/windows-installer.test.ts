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

test('Windows source download resolves a ref once and extracts only its immutable revision',windows,async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-source-download-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const result=await run(`
 $script:PrismTestUrls = @()
 function Invoke-WebRequest { param([switch]$UseBasicParsing, $Headers, $Uri, $OutFile)
  $script:PrismTestUrls += [string]$Uri
  if ($Uri -like 'https://api.github.com/*') { [IO.File]::WriteAllText($OutFile, '{"sha":"${'a'.repeat(40)}"}') }
  else { [IO.File]::WriteAllText($OutFile, 'synthetic archive') }
 }
 function Expand-Archive { param($LiteralPath, $DestinationPath)
  [void][IO.Directory]::CreateDirectory((Join-Path $DestinationPath 'herdr-prism-${'a'.repeat(40)}'))
 }
 $download = Get-PrismSource -InstallRef 'feature/test' -Directory ${literal(root)}
 if ($download.Revision -ne '${'a'.repeat(40)}') { throw 'Wrong immutable revision' }
 Write-Output ($script:PrismTestUrls | ConvertTo-Json -Compress)
 `);
 const urls=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!);
 assert.deepEqual(urls,['https://api.github.com/repos/alexiob/herdr-prism/commits/feature%2Ftest','https://codeload.github.com/alexiob/herdr-prism/zip/'+'a'.repeat(40)]);
});

test('Windows installed runtime binds every Node command and repairs legacy open promise cleanup idempotently',windows,async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-runtime-bind-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const {mkdir}=await import('node:fs/promises');await mkdir(join(root,'dist/entrypoints'),{recursive:true});
 const manifest=join(root,'herdr-plugin.toml'),action=join(root,'dist/entrypoints/action.js');
 const original='[[actions]]\ncommand = ["node", "dist/entrypoints/action.js", "open"]\n[[events]]\ncommand = ["node", "dist/entrypoints/event.js"]\n';await writeFile(manifest,original);await writeFile(action,'            return openPanel(rpc);\n            return openPanel(rpc, { existingPaneId: current.paneId });\n');
 const call='Set-PrismInstalledRuntime -PluginRoot '+literal(root)+' -NodeExe '+literal(process.execPath);
 await run('$before=(Get-Acl -LiteralPath '+literal(manifest)+').Sddl; '+call+'; '+call+'; if ((Get-Acl -LiteralPath '+literal(manifest)+').Sddl -ne $before) { throw "ACL changed" }');
 let output=await readFile(manifest,'utf8');assert.equal(output.match(/command = \[/g)?.length,2);assert.ok(!output.includes('["node"'));assert.ok(output.includes(JSON.stringify(process.execPath)));
 await writeFile(manifest,output.replaceAll(JSON.stringify(process.execPath),JSON.stringify(join(root,'old-runtime/node.exe'))));await run(call);
 output=await readFile(manifest,'utf8');assert.ok(!output.includes('old-runtime'));assert.ok(output.includes(JSON.stringify(process.execPath)));
 assert.equal(await readFile(manifest+'.prism-windows.bak','utf8'),original);assert.match(await readFile(action,'utf8'),/return await openPanel/);assert.ok(!(await readFile(action,'utf8')).includes('await await'));
});

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

test('Windows uninstall removes only its exact shortcut and preserves unrelated edits and ACL',windows,async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-shortcut-remove-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const config=join(root,'config.toml'),original='\ufeff# original\r\n[keys]\r\nprevious_tab = "prefix+p"\r\n';await writeFile(config,original);
 await run('Set-PrismShortcut -ConfigPath '+literal(config)+' -NodeExe '+literal(process.execPath)+' -PluginRoot '+literal(resolve('.')));
 const extra='\r\n[[keys.command]]\r\nkey = "prefix+u"\r\ntype = "shell"\r\ncommand = "echo keep"\r\n';await writeFile(config,(await readFile(config,'utf8'))+extra);
 const call='Remove-PrismShortcut -ConfigPath '+literal(config);
 await run('$before=(Get-Acl -LiteralPath '+literal(config)+').Sddl; '+call+'; '+call+'; if ((Get-Acl -LiteralPath '+literal(config)+').Sddl -ne $before) { throw "ACL changed" }');
 assert.equal(await readFile(config,'utf8'),original+extra);
});

test('Windows uninstall refuses an edited owned shortcut and preserves a user-owned Prism shortcut',windows,async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-shortcut-edited-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const config=join(root,'config.toml');await writeFile(config,'');await run('Set-PrismShortcut -ConfigPath '+literal(config)+' -NodeExe '+literal(process.execPath)+' -PluginRoot '+literal(resolve('.')));
 const installed=await readFile(config,'utf8');
 for(const edited of [installed.replace('prefix+i','prefix+d'),installed+'extra = true\n',installed+installed.replace('prefix+i','prefix+d')]){
  await writeFile(config,edited);await assert.rejects(run('Remove-PrismShortcut -ConfigPath '+literal(config)));assert.equal(await readFile(config,'utf8'),edited);
 }
 const userOwned=installed.replace('# Prism Windows installer shortcut\n','');await writeFile(config,userOwned);await run('Remove-PrismShortcut -ConfigPath '+literal(config));assert.equal(await readFile(config,'utf8'),userOwned);
});

test('Windows bootstrap enforces Node minimum and rejects malformed versions',windows,async()=>{
 const result=await run("@('v22.12.9','v22.13.0','v24.21.0','garbage','v24.0.0-beta') | ForEach-Object { Test-PrismNodeVersion $_ }");
 assert.deepEqual(result.stdout.trim().split(/\r?\n/),['False','True','True','False','False']);
});

test('Windows bootstrap accepts only a compatible x64 Node runtime',windows,async()=>{
 const result=await run("Test-PrismNodeRuntime 'v22.13.0' 'ia32'; Test-PrismNodeRuntime 'v22.13.0' 'x64'; Test-PrismNodeRuntime 'v22.12.9' 'x64'; Test-PrismNodeRuntime 'v24.21.0' 'arm64'");
 assert.deepEqual(result.stdout.trim().split(/\r?\n/),['False','True','False','False']);
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
