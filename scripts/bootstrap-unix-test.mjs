import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm,open,realpath,access,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const exec=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url));
async function until(probe,label){for(let i=0;i<100;i++){try{const result=await probe();if(result)return result;}catch{}await delay(100);}throw new Error('Timed out: '+label);}
export async function bootstrapUnixTest({herdr,proof,publicRef}){
 if(!herdr||!proof)throw new Error('--herdr and --proof are required');
 herdr=await realpath(resolve(herdr));proof=resolve(proof);await mkdir(proof,{recursive:true});
 if(publicRef!==undefined&&!/^[a-f0-9]{40}$/.test(publicRef))throw new Error('--public-ref must be an immutable commit');
 const sourceArgs=publicRef?['--ref',publicRef]:['--source-dir',root];
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
 const evidence={kind:'actual-isolated-Unix-bootstrap',ok:false,platform:process.platform,arch:process.arch,source:publicRef?{kind:'actual-GitHub-download',commit:publicRef}:{kind:'reviewed-local-source'},checks:{},limits:['Headless server and terminal readback; native sidebar pixels are not certified.',...(publicRef?[]:['Live proof uses local reviewed source; immutable GitHub resolution/archive dataflow is covered by offline download fixtures.'])]};
 let managedDir,nodeBin,receipt,freshHerdr;
 try{
  await until(async()=>(await cli(['status','server','--json'])).running,'server ready');
  await cli(['workspace','create','--cwd',directory,'--label','Prism installer proof','--focus']);
  const script=publicRef?(await exec('curl',['-fsSL',`https://raw.githubusercontent.com/alexiob/herdr-prism/${publicRef}/install.sh`],{timeout:30000})).stdout:await readFile(join(root,'install.sh'),'utf8');
  const install=exec('/bin/sh',['-s','--',...sourceArgs,'--herdr-bin',herdr,'--session',session,'--no-start'],{env,cwd:directory,encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024});install.child.stdin.end(script);
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
  // Repeat the exact installer while its inspector is still open. The private
  // fixture contains invented Notes only; no provider or user history is read.
  const servers=await readdir(join(receipt.stateDir,'servers'));assert.equal(servers.length,1);
  const serverDir=join(receipt.stateDir,'servers',servers[0]);
  const {StateStore}=await import(pathToFileURL(join(managedDir,'dist/state/store.js')).href);
  const {NotesStore}=await import(pathToFileURL(join(managedDir,'dist/state/notes.js')).href);
  const {panelViewStore}=await import(pathToFileURL(join(managedDir,'dist/runtime/panel-views.js')).href);
  const {HerdrClient}=await import(pathToFileURL(join(managedDir,'dist/herdr/client.js')).href);
  const state=new StateStore(serverDir),rpc=new HerdrClient((await cli(['status','server','--json'])).socket,{timeoutMs:5000});
  let record=JSON.parse(await readFile(join(serverDir,'pane.json'),'utf8')),shortcutPreferences,inspectorPid;
  assert.equal(typeof record.paneId,'string');
  try{
   const views=await state.read('views'),view=views.find(value=>value.paneId===record.paneId&&value.open);assert.ok(view?.targetTerminalId);
   const notes=await new NotesStore(serverDir).save('codex:bootstrap-update-fixture','# Synthetic bootstrap fixture\n\nPreserve these invented Notes across an installer rerun.\n',null);
   const preferences=panelViewStore(serverDir,view.tabId,view.targetTerminalId);
   shortcutPreferences=preferences;
   await preferences.write('preferences',{pin:true,tab:'Refs',collapsed:['fixture-fold'],expanded:['fixture-expand'],readers:[]});
   const exported=await rpc.call('layout.export',{pane_id:record.paneId});
   const find=(node,path=[])=>{if(node?.type!=='split')return;if(node.second?.type==='pane'&&node.second.pane_id===record.paneId)return{path,ratio:node.ratio};return find(node.first,[...path,false])??find(node.second,[...path,true]);};
   const split=find(exported.layout.root);assert.ok(split,'owned inspector split');
   await rpc.call('layout.set_split_ratio',{pane_id:record.paneId,path:split.path,ratio:Math.min(0.85,split.ratio+0.07)});
   const panelWidth=snapshot=>snapshot.layouts.find(layout=>layout.tab_id===view.tabId)?.panes.find(pane=>pane.pane_id===snapshot.panes.find(pane=>pane.terminal_id===record.terminalId)?.pane_id)?.rect.width;
   await until(async()=>(await preferences.read('panel-size'))?.custom===true,'user width preference recorded');
   await cli(['plugin','pane','focus',record.paneId]);
   const before=(await cli(['api','snapshot'])).result.snapshot,beforeWidth=panelWidth(before);
   const focus=(snapshot,records)=>{const pane=snapshot.panes.find(value=>value.pane_id===snapshot.focused_pane_id),owned=records.find(value=>value.terminalId===pane?.terminal_id);return owned?{panelTarget:owned.targetTerminalId}:{nativeTerminal:pane?.terminal_id};};
   const intent=records=>records.map(({tabId,targetTerminalId,open})=>({tabId,targetTerminalId,open})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
   const beforeFocus=focus(before,views),beforeIntent=intent(views),receiptBytes=await readFile(join(managedDir,'.hat-managed-install.json'));
   const privateFiles=[notes.path,join(preferences.dir,'preferences.json'),join(preferences.dir,'panel-size.json'),join(receipt.configDir,'settings.json')];
   const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),privateHashes=await Promise.all(privateFiles.map(async file=>hash(await readFile(file))));
   const rerun=exec('/bin/sh',['-s','--',...sourceArgs,'--herdr-bin',herdr,'--session',session,'--no-start'],{env,cwd:directory,encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024});rerun.child.stdin.end(script);
   const updateOutput=await rerun;await writeFile(join(proof,'installer-rerun.log'),updateOutput.stdout+updateOutput.stderr,{mode:0o600});assert.match(updateOutput.stdout,/updated to 0\.5\.0/);
   const updated=(await cli(['plugin','list','--plugin','iob.herdr-prism','--json'])).result.plugins[0];assert.equal(updated.version,'0.5.0');assert.equal(updated.plugin_root,managedDir);assert.equal(updated.enabled,registration.enabled);
   assert.deepEqual(await readFile(join(managedDir,'.hat-managed-install.json')),receiptBytes,'managed ownership receipt preserved exactly');
   assert.deepEqual(await Promise.all(privateFiles.map(async file=>hash(await readFile(file)))),privateHashes,'invented Notes and private preference bytes preserved');
   const restoredViews=await state.read('views');assert.deepEqual(intent(restoredViews),beforeIntent);record=JSON.parse(await readFile(join(serverDir,'pane.json'),'utf8'));inspectorPid=restoredViews.find(value=>value.paneId===record.paneId)?.pid;assert.ok(Number.isSafeInteger(inspectorPid)&&inspectorPid>0);
   const after=(await cli(['api','snapshot'])).result.snapshot;assert.deepEqual(focus(after,restoredViews),beforeFocus);assert.equal(panelWidth(after),beforeWidth);assert.equal(server.exitCode,null);
   evidence.checks.installerRerun={sameCommand:true,version:'0.5.0',sameCanonicalRoot:true,exactReceiptPreserved:true,syntheticNotesAndPreferencesPreserved:true,openIntentPreserved:true,focusPreserved:true,widthPreserved:true,nodeAbsentFromServerPath:true,serverPreserved:true};
  }finally{rpc.close();}
  // Close the inspector, then reopen through real Ctrl+B / i on a client PTY.
  await cli(['plugin','pane','close',record.paneId]);
  await until(async()=>!(await cli(['api','snapshot'])).result.snapshot.panes.some(p=>p.pane_id===record.paneId),'closed original inspector');
  await until(()=>{try{process.kill(inspectorPid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}},'closed inspector finished preference save');
  // The separate shortcut fixture intentionally expects Overview. Reset only
  // this invented preference after the preservation assertions have completed.
  await shortcutPreferences.write('preferences',{pin:false,tab:'Overview',collapsed:[],expanded:[],readers:[]});
  const client=await exec('python3',[join(root,'scripts/smoke/prism-shortcut.py'),herdr,session],{env,cwd:directory,encoding:'utf8',timeout:30000,maxBuffer:65536});
  evidence.checks.shortcutPTY=JSON.parse(client.stdout);
  await exec(nodeBin,[join(managedDir,'scripts/live-install.mjs'),'uninstall','--herdr-bin',herdr,'--session',session],{env,cwd:directory,timeout:90000});
  assert.equal((await cli(['plugin','list','--plugin','iob.herdr-prism','--json'])).result.plugins.length,0);
  for(const path of [managedDir,receipt.configDir,receipt.stateDir])await assert.rejects(access(path));
  assert.equal(await readFile(configPath,'utf8'),original);await access(nodeBin);assert.equal(server.exitCode,null);
  evidence.checks.completeRemoval={registryRemoved:true,managedFilesRemoved:true,stateAndConfigRemoved:true,shortcutAndLayoutRestored:true,sharedNodeRetained:true,existingServerPreserved:true};
  const prepare=exec('/bin/sh',['-s','--',...sourceArgs,'--herdr-bin',herdr,'--prepare-only'],{env,cwd:directory,encoding:'utf8',timeout:180000});prepare.child.stdin.end(script);assert.match((await prepare).stdout,/prerequisites ready/);
  evidence.checks.repeatDependencySetup={verifiedPrivateNodeReused:true};
  // With both runtimes absent from PATH, reuse private Node and supply Herdr.
  const prepareHerdr=exec('/bin/sh',['-s','--',...sourceArgs,'--prepare-only'],{env,cwd:directory,encoding:'utf8',timeout:180000});prepareHerdr.child.stdin.end(script);assert.match((await prepareHerdr).stdout,/prerequisites ready/);
  freshHerdr=join(directory,'d/herdr-prism/dependencies',`herdr-v0.9.3-${process.platform}-${process.arch}`,'herdr');
  assert.equal((await exec(freshHerdr,['--version'],{env})).stdout.trim(),'herdr 0.9.3');
  await mkdir(settingsDir,{recursive:true,mode:0o700});await writeFile(join(settingsDir,'settings.json'),JSON.stringify({providerHomes}),{mode:0o600});
  const fresh=exec('/bin/sh',['-s','--',...sourceArgs,'--session','fresh','--inspector-only'],{env,cwd:directory,encoding:'utf8',timeout:180000});fresh.child.stdin.end(script);const freshOutput=await fresh;
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
 const options={};for(let i=2;i<process.argv.length;i++){const arg=process.argv[i];if(!['--herdr','--proof','--public-ref'].includes(arg)||!process.argv[i+1])throw new Error('Unknown option: '+arg);options[arg==='--public-ref'?'publicRef':arg.slice(2)]=process.argv[++i];}
 await bootstrapUnixTest(options);console.log('Unix bootstrap live proof passed');
}
