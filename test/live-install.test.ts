import {freshPrivateDirectory} from './helpers/private-dir.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,rm,cp,access,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import ts from 'typescript';
import {createHash} from 'node:crypto';
// @ts-ignore dependency-free release lifecycle utility
import {liveInstall,liveUninstall} from '../scripts/live-install.mjs';
async function fixture(t:any){
 const dir=await freshPrivateDirectory(join(tmpdir(),'hat lifecycle-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const root=join(dir,'reviewed release'),managedDir=join(dir,'managed install'),control=join(dir,'control.json'),registry=join(dir,'registry.json'),log=join(dir,'argv.json'),job=join(dir,'job.json');
 await mkdir(root);for(const sub of ['dist/entrypoints','dist/herdr','dist/config','companion/pi','scripts'])await mkdir(join(root,sub),{recursive:true});
 for(const name of ['action','startup','event','inspector','detail'])await writeFile(join(root,'dist/entrypoints',name+'.js'),'export const fixture=true;');
 await writeFile(join(root,'dist/herdr/protocol.json'),JSON.stringify({protocol:22,schemas:{request:{}}}));await writeFile(join(root,'companion/pi/index.js'),'export default ()=>{};');
 await writeFile(join(root,'package.json'),JSON.stringify({name:'herdr-prism',type:'module',version:'0.1.0'}));await writeFile(join(root,'herdr-plugin.toml'),'id = "iob.herdr-prism"\n');
 // Tests run before the project build in CI. Compile test-only security fixtures from source.
 for(const file of await readdir('src/config'))if(file.endsWith('.ts')){const built=ts.transpileModule(await readFile(join('src/config',file),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,rewriteRelativeImportExtensions:true}});await writeFile(join(root,'dist/config',file.replace(/\.ts$/,'.js')),built.outputText);}
 await cp('scripts/check-install.mjs',join(root,'scripts/check-install.mjs'));await cp('scripts/live-install.mjs',join(root,'scripts/live-install.mjs'));
 await writeFile(join(root,'release.json'),JSON.stringify({version:1,platforms:['linux-x64']}));const files:Record<string,string>={};const index=async(dir:string,prefix='')=>{for(const file of await readdir(dir,{withFileTypes:true})){const name=prefix?prefix+'/'+file.name:file.name;if(file.isDirectory())await index(join(dir,file.name),name);else files[name]=createHash('sha256').update(await readFile(join(dir,file.name))).digest('hex');}};await index(root);await writeFile(join(root,'checksums.json'),JSON.stringify({version:1,files}));await writeFile(control,'{}');await writeFile(registry,'null');await writeFile(log,'[]');const fake=join(dir,'fake-herdr.mjs');
 await writeFile(fake,`
import {readFile,writeFile}from'node:fs/promises';import{join}from'node:path';import{pathToFileURL}from'node:url';
const args=process.argv.slice(2),control=JSON.parse(await readFile(${JSON.stringify(control)},'utf8'));let registry=JSON.parse(await readFile(${JSON.stringify(registry)},'utf8'));const log=JSON.parse(await readFile(${JSON.stringify(log)},'utf8'));log.push(args);await writeFile(${JSON.stringify(log)},JSON.stringify(log));
if(control.hangCli)await new Promise(done=>setTimeout(done,20000));
if(control.actionDelay&&args[1]==='action')await new Promise(done=>setTimeout(done,control.actionDelay));
if(args[1]==='list')console.log(JSON.stringify({id:'cli:plugin',result:{type:'plugin_list',plugins:registry?[registry]:[]}}));
if(args[1]==='link'){registry={plugin_id:'iob.herdr-prism',plugin_root:args[2],enabled:false};await writeFile(${JSON.stringify(registry)},JSON.stringify(registry));}
if(args[1]==='enable'){registry.enabled=true;await writeFile(${JSON.stringify(registry)},JSON.stringify(registry));}
if(args[1]==='disable'){registry.enabled=false;await writeFile(${JSON.stringify(registry)},JSON.stringify(registry));}
if(args[1]==='log')console.log(JSON.stringify({id:'cli:plugin',result:{type:'plugin_log_list',logs:[JSON.parse(await readFile(${JSON.stringify(job)},'utf8'))]}}));
if(args[1]==='uninstall')await writeFile(${JSON.stringify(registry)},'null');
if(args[1]==='action'){
 const root=registry.plugin_root;const request=JSON.parse(await readFile(join(root,'.hat-lifecycle-request.json'),'utf8'));const receipt=JSON.parse(await readFile(join(root,'.hat-managed-install.json'),'utf8'));
 const configDir=${JSON.stringify(join(dir,'config'))},stateDir=${JSON.stringify(join(dir,'state'))};const {ensurePrivateDir}=await import(pathToFileURL(join(root,'dist/config/index.js')));
 for(const target of [configDir,stateDir]){await ensurePrivateDir(target);if(!control.badOwner)await writeFile(join(target,'.hat-lifecycle-owner.json'),JSON.stringify({version:1,pluginId:receipt.pluginId,token:receipt.token,installRoot:root}));}
 await writeFile(${JSON.stringify(job)},JSON.stringify({log_id:request.requestId,plugin_id:receipt.pluginId,status:control.noFinish?'running':'succeeded',exit_code:control.noFinish?undefined:0}));console.log(JSON.stringify({id:'cli:plugin',result:{type:'plugin_action_invoked',log:{log_id:request.requestId,plugin_id:receipt.pluginId,status:'running'}}}));if(!control.noAck){await new Promise(done=>setTimeout(done,20));await writeFile(join(root,'.hat-lifecycle-result.json'),JSON.stringify({version:1,pluginId:receipt.pluginId,token:control.badToken?'foreign':receipt.token,requestId:request.requestId,operation:request.operation,ok:!control.error,...(control.error?{error:'activation refused'}:{result:{[request.operation==='activate'?'activated':'deactivated']:true,configDir:control.badDir?${JSON.stringify(dir)}:configDir,stateDir,conflicts:control.conflicts?['ui.sidebar.agents.rows']:[]}})}));}
}
`);
 return {dir,root,managedDir,control,registry,log,herdrBin:process.execPath,herdrPrefix:[fake],platform:'linux',arch:'x64',timeoutMs:3000};
}
async function exists(path:string){return access(path).then(()=>true,()=>false);}
test('one live install enables and waits authenticated activation; uninstall removes only owned copies',async t=>{
 const f=await fixture(t),installed=await liveInstall(f);assert.equal(installed.activated,true);assert.equal(installed.mode,'own-native');assert.equal(JSON.parse(await readFile(f.registry,'utf8')).enabled,true);assert.ok(await exists(join(f.managedDir,'.hat-managed-install.json')));
 const uninstalled=await liveUninstall(f);assert.equal(uninstalled.removed,true);assert.equal(JSON.parse(await readFile(f.registry,'utf8')),null);for(const path of [f.managedDir,join(f.dir,'config'),join(f.dir,'state')])assert.equal(await exists(path),false);assert.equal(await exists(join(f.root,'herdr-plugin.toml')),true);
 const calls=JSON.parse(await readFile(f.log,'utf8'));assert.ok(calls.some((x:string[])=>x[1]==='link'&&x.includes('--disabled')));assert.ok(calls.findIndex((x:string[])=>x.includes('deactivate'))<calls.findIndex((x:string[])=>x[1]==='uninstall'));
});
test('live installer refuses foreign registration before writing managed files',async t=>{const f=await fixture(t);await writeFile(f.registry,JSON.stringify({plugin_id:'iob.herdr-prism',plugin_root:join(f.dir,'foreign'),enabled:true}));await assert.rejects(liveInstall(f),/already registered|foreign/i);assert.equal(await exists(f.managedDir),false);assert.equal(JSON.parse(await readFile(f.registry,'utf8')).plugin_root,join(f.dir,'foreign'));});
test('deactivation conflicts retain registration, backups and managed installation',async t=>{const f=await fixture(t);await liveInstall(f);await writeFile(f.control,JSON.stringify({conflicts:true}));await assert.rejects(liveUninstall(f),/conflict/i);assert.ok(await exists(f.managedDir));assert.ok(await exists(join(f.dir,'config')));assert.ok(JSON.parse(await readFile(f.registry,'utf8')));});
test('purge refuses unproved directories and mismatched completion tokens',async t=>{const f=await fixture(t);await liveInstall(f);await writeFile(f.control,JSON.stringify({badDir:true}));await assert.rejects(liveUninstall(f),/ownership|owned|directory/i);assert.ok(await exists(f.root));assert.ok(await exists(f.managedDir));await writeFile(f.control,JSON.stringify({badToken:true}));await assert.rejects(liveUninstall({...f,timeoutMs:3000}),/authentication|timed out/i);assert.ok(JSON.parse(await readFile(f.registry,'utf8')));});
test('an async CLI invocation ID is not completed activation',async t=>{const f=await fixture(t);await writeFile(f.control,JSON.stringify({noAck:true}));await assert.rejects(liveInstall({...f,timeoutMs:200}),/timed out/i);assert.ok(await exists(f.managedDir));assert.ok(JSON.parse(await readFile(f.registry,'utf8')));});

test('authenticated acknowledgement alone cannot purge while the Herdr action still runs',async t=>{const f=await fixture(t);await liveInstall(f);await writeFile(f.control,JSON.stringify({noFinish:true}));await assert.rejects(liveUninstall({...f,timeoutMs:250}),/action.*finish|action.*timed out/i);assert.ok(await exists(f.managedDir));assert.ok(await exists(join(f.dir,'state')));assert.ok(JSON.parse(await readFile(f.registry,'utf8')));});

test('slow CLI startup remains separate from the short action completion deadline',async t=>{const f=await fixture(t);await liveInstall(f);await writeFile(f.control,JSON.stringify({actionDelay:350,noFinish:true}));await assert.rejects(liveUninstall({...f,timeoutMs:100}),/Herdr deactivate action timed out before it finished/);assert.ok(await exists(f.managedDir));assert.ok(JSON.parse(await readFile(f.registry,'utf8')));});
test('a hung Herdr CLI is bounded and reports its own command timeout',async t=>{const f=await fixture(t);await writeFile(f.control,JSON.stringify({hangCli:true}));const started=Date.now();await assert.rejects(liveInstall({...f,timeoutMs:100}),/Herdr CLI command timed out after 5000 ms: plugin list/);assert.ok(Date.now()-started<12000,'CLI timeout must bound the hung child');assert.equal(await exists(f.managedDir),false);assert.equal(JSON.parse(await readFile(f.registry,'utf8')),null);});

test('live installation requires a checksummed release rather than an unverified source tree',async t=>{const f=await fixture(t);await rm(join(f.root,'checksums.json'));await rm(join(f.root,'release.json'));await assert.rejects(liveInstall(f),/checksummed release|checksum/i);assert.equal(await exists(f.managedDir),false);assert.equal(JSON.parse(await readFile(f.registry,'utf8')),null);});
test('inspector-only explicitly selects coexistence activation without native takeover',async t=>{const f=await fixture(t);const installed=await liveInstall({...f,inspectorOnly:true});assert.equal(installed.mode,'inspector-only');const calls=JSON.parse(await readFile(f.log,'utf8'));assert.ok(calls.some((x:string[])=>x.includes('activate-inspector')));assert.ok(!calls.some((x:string[])=>x.includes('activate-overview')));await liveUninstall(f);});
