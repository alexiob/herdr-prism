import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm,open,realpath,access,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const exec=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url));
async function until(probe,label){for(let i=0;i<100;i++){try{const result=await probe();if(result)return result;}catch{}await delay(100);}throw new Error('Timed out: '+label);}
export async function bootstrapUnixTest({herdr,proof}){
 if(!herdr||!proof)throw new Error('--herdr and --proof are required');
 herdr=await realpath(resolve(herdr));proof=resolve(proof);await mkdir(proof,{recursive:true});
 const directory=await mkdtemp('/tmp/prism-bootstrap-live-'),session='bootstrap';
 const configPath=join(directory,'c/herdr/config.toml'),settingsDir=join(directory,'c/herdr/plugins/config/iob.herdr-prism');
 await mkdir(settingsDir,{recursive:true,mode:0o700});
 const providerHomes={codex:join(directory,'codex'),claude:join(directory,'claude'),pi:join(directory,'pi')};
 for(const home of Object.values(providerHomes))await mkdir(home,{mode:0o700});
 await writeFile(join(settingsDir,'settings.json'),JSON.stringify({providerHomes,sampleIntervalMs:2000}),{mode:0o600});
 const original='onboarding = false\n[server]\nheadless_cols = 140\nheadless_rows = 40\n[ui.sidebar.agents]\nrows = [["agent", "workspace", "tab"]]\n';
 await writeFile(configPath,original,{mode:0o600});
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('HERDR_'))delete env[key];
 Object.assign(env,{PATH:'/usr/bin:/bin',SHELL:'/bin/sh',XDG_CONFIG_HOME:join(directory,'c'),XDG_STATE_HOME:join(directory,'s'),XDG_DATA_HOME:join(directory,'d'),HERDR_CONFIG_PATH:configPath,TERM:'xterm-256color'});
 await assert.rejects(exec('/bin/sh',['-c','command -v node'],{env}), 'server PATH must lack Node');
 const log=await open(join(proof,'server.log'),'w',0o600);
 const server=spawn(herdr,['--session',session,'server'],{env,cwd:directory,stdio:['ignore',log.fd,log.fd]});
 const cli=async args=>{const result=await exec(herdr,['--session',session,...args],{env,cwd:directory,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});return JSON.parse(result.stdout);};
 const evidence={kind:'actual-isolated-Unix-bootstrap',ok:false,platform:process.platform,arch:process.arch,checks:{},limits:['Headless server and terminal readback; native sidebar pixels are not certified.','Local reviewed source option exercises this exact working tree. Public immutable GitHub download is checked separately.']};
 let managedDir,nodeBin,receipt,freshHerdr;
 try{
  await until(async()=>(await cli(['status','server','--json'])).running,'server ready');
  await cli(['workspace','create','--cwd',directory,'--label','Prism installer proof','--focus']);
  const script=await readFile(join(root,'install.sh'),'utf8');
  const install=exec('/bin/sh',['-s','--','--source-dir',root,'--herdr-bin',herdr,'--session',session,'--no-start'],{env,cwd:directory,encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024});install.child.stdin.end(script);
  const output=await install;await writeFile(join(proof,'install.log'),output.stdout+output.stderr,{mode:0o600});
  assert.match(output.stdout,/active in the selected/);assert.match(output.stdout,/Ctrl\+B, then i/);
  const registration=(await cli(['plugin','list','--plugin','iob.herdr-prism','--json'])).result.plugins[0];
  managedDir=registration.plugin_root;receipt=JSON.parse(await readFile(join(managedDir,'.hat-managed-install.json'),'utf8'));
  const manifest=await readFile(join(managedDir,'herdr-plugin.toml'),'utf8');
  const commands=manifest.split('\n').filter(line=>/^command\s*=/.test(line)).map(line=>JSON.parse(line.slice(line.indexOf('=')+1)));
  nodeBin=commands[0][0];assert.ok(nodeBin.startsWith(await realpath(join(directory,'d/herdr-prism/dependencies'))+'/'));assert.ok(commands.every(command=>command[0]===nodeBin));
  assert.equal((await exec(nodeBin,['--version'],{env})).stdout.trim(),'v24.21.0');
  const configured=await readFile(configPath,'utf8');assert.match(configured,/key = "prefix\+i"/);assert.match(configured,/command = "iob.herdr-prism.open"/);
  assert.equal(server.exitCode,null,'existing server was not restarted');
  evidence.checks.liveInstall={pipeline:true,pinnedNode:'24.21.0',nodeAbsentFromServerPath:true,allManifestCommandsAbsolute:true,authenticatedActive:true,existingServerPreserved:true,shortcutConfigured:true};
  // Close the inspector, then reopen through real Ctrl+B / i on a client PTY.
  const servers=await readdir(join(receipt.stateDir,'servers'));assert.equal(servers.length,1);
  const record=JSON.parse(await readFile(join(receipt.stateDir,'servers',servers[0],'pane.json'),'utf8'));
  assert.equal(typeof record.paneId,'string');
  await cli(['plugin','pane','close',record.paneId]);
  await until(async()=>!(await cli(['api','snapshot'])).result.snapshot.panes.some(p=>p.pane_id===record.paneId),'closed original inspector');
  const client=await exec('python3',[join(root,'scripts/smoke/prism-shortcut.py'),herdr,session],{env,cwd:directory,encoding:'utf8',timeout:30000,maxBuffer:65536});
  evidence.checks.shortcutPTY=JSON.parse(client.stdout);
  await exec(nodeBin,[join(managedDir,'scripts/live-install.mjs'),'uninstall','--herdr-bin',herdr,'--session',session],{env,cwd:directory,timeout:90000});
  assert.equal((await cli(['plugin','list','--plugin','iob.herdr-prism','--json'])).result.plugins.length,0);
  for(const path of [managedDir,receipt.configDir,receipt.stateDir])await assert.rejects(access(path));
  assert.equal(await readFile(configPath,'utf8'),original);await access(nodeBin);assert.equal(server.exitCode,null);
  evidence.checks.completeRemoval={registryRemoved:true,managedFilesRemoved:true,stateAndConfigRemoved:true,shortcutAndLayoutRestored:true,sharedNodeRetained:true,existingServerPreserved:true};
  const prepare=exec('/bin/sh',['-s','--','--source-dir',root,'--herdr-bin',herdr,'--prepare-only'],{env,cwd:directory,encoding:'utf8',timeout:30000});prepare.child.stdin.end(script);assert.match((await prepare).stdout,/prerequisites ready/);
  evidence.checks.repeatDependencySetup={verifiedPrivateNodeReused:true};
  // With both runtimes absent from PATH, reuse private Node and supply Herdr.
  const prepareHerdr=exec('/bin/sh',['-s','--','--source-dir',root,'--prepare-only'],{env,cwd:directory,encoding:'utf8',timeout:180000});prepareHerdr.child.stdin.end(script);assert.match((await prepareHerdr).stdout,/prerequisites ready/);
  freshHerdr=join(directory,'d/herdr-prism/dependencies',`herdr-v0.9.3-${process.platform}-${process.arch}`,'herdr');
  assert.equal((await exec(freshHerdr,['--version'],{env})).stdout.trim(),'herdr 0.9.3');
  await mkdir(settingsDir,{recursive:true,mode:0o700});await writeFile(join(settingsDir,'settings.json'),JSON.stringify({providerHomes}),{mode:0o600});
  const fresh=exec('/bin/sh',['-s','--','--source-dir',root,'--session','fresh','--inspector-only'],{env,cwd:directory,encoding:'utf8',timeout:180000});fresh.child.stdin.end(script);const freshOutput=await fresh;
  assert.match(freshOutput.stdout,/active in the selected/);assert.match(freshOutput.stdout,/Attach with/);
  const freshCli=async args=>JSON.parse((await exec(freshHerdr,['--session','fresh',...args],{env,cwd:directory,encoding:'utf8',timeout:30000})).stdout);
  managedDir=(await freshCli(['plugin','list','--plugin','iob.herdr-prism','--json'])).result.plugins[0].plugin_root;
  receipt=JSON.parse(await readFile(join(managedDir,'.hat-managed-install.json'),'utf8'));
  const freshConfig=await readFile(configPath,'utf8');assert.match(freshConfig,/key = "prefix\+i"/);assert.ok(freshConfig.includes('rows = [["agent", "workspace", "tab"]]'));assert.ok(!freshConfig.includes('hat_'));
  await exec(nodeBin,[join(managedDir,'scripts/live-install.mjs'),'uninstall','--herdr-bin',freshHerdr,'--session','fresh'],{env,cwd:directory,timeout:90000});
  assert.equal((await freshCli(['plugin','list','--plugin','iob.herdr-prism','--json'])).result.plugins.length,0);
  for(const path of [managedDir,receipt.configDir,receipt.stateDir])await assert.rejects(access(path));
  assert.equal(await readFile(configPath,'utf8'),original);await access(nodeBin);await access(freshHerdr);
  evidence.checks.freshSetup={officialHerdrDownloadVerified:true,pinnedHerdr:'0.9.3',headlessServerStarted:true,initialWorkspaceCreated:true,inspectorOnlyShortcutConfigured:true,completeRemoval:true,sharedDependenciesRetained:true};
  evidence.ok=true;return evidence;
 }finally{
  if(managedDir&&nodeBin&&server.exitCode===null){try{await exec(nodeBin,[join(managedDir,'scripts/live-install.mjs'),'uninstall','--herdr-bin',herdr,'--session',session],{env,timeout:90000});}catch{}}
  if(freshHerdr){try{await exec(freshHerdr,['--session','fresh','server','stop'],{env,timeout:30000});}catch{}}
  try{await cli(['server','stop']);}catch{}
  if(server.exitCode===null)await until(()=>server.exitCode!==null,'owned server exit').catch(()=>server.kill('SIGTERM'));
  await log.close();await writeFile(join(proof,'bootstrap.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
  await rm(directory,{recursive:true,force:true});
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let i=2;i<process.argv.length;i++){const arg=process.argv[i];if(!['--herdr','--proof'].includes(arg)||!process.argv[i+1])throw new Error('Unknown option: '+arg);options[arg.slice(2)]=process.argv[++i];}
 await bootstrapUnixTest(options);console.log('Unix bootstrap live proof passed');
}
