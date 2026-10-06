import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,open,lstat,realpath,rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const exec=promisify(execFile),project=fileURLToPath(new URL('..',import.meta.url));
const pluginId='iob.herdr-prism';
async function until(label,probe,timeout=20000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{const value=await probe();if(value)return value;}catch(error){last=error;}await delay(100);}throw Error(`${label} timed out${last?': '+last.message:''}`);}
const inside=(root,value)=>{const rel=path.relative(root,value);return rel!==''&&!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};

/** Real public GitHub install/reinstall on a disposable named Herdr 0.9.3 server.
 * It never copies credentials, controls the user's server, or invokes a provider.
 * Bare Herdr uninstall removes its checkout and retains user config/state in0.9.3;
 * the final harness cleanup removes only this harness's entire temporary root.
 */
export async function githubHerdrTest({repo='alexiob/herdr-prism',ref,expectedCommit,herdr=process.env.HERDR_BIN_PATH??'herdr',proof=path.join(project,'artifacts/github-herdr-proof')}={}){
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw Error('--repo must be owner/repo');
 if(ref&&(!/^[A-Za-z0-9_./-]{1,128}$/.test(ref)||ref.startsWith('-')))throw Error('Invalid --ref');
 if(expectedCommit&&!/^[a-f0-9]{40}$/.test(expectedCommit))throw Error('--expected-commit must be a full lowercase Git commit');
 proof=path.resolve(proof);await mkdir(proof,{recursive:true});
 const load=file=>import(pathToFileURL(path.join(project,file)).href);
 const {HerdrClient}=await load('dist/herdr/client.js');
 const {StateStore,identityName}=await load('dist/state/store.js');
 const {MailboxClient}=await load('dist/state/mailbox.js');
 const directory=await mkdtemp(path.join(process.platform==='win32'?os.tmpdir():'/tmp','hpg-'));
 const name='github',configHome=path.join(directory,'c'),stateHome=path.join(directory,'s'),configPath=path.join(configHome,'herdr','config.toml');
 const original='[server]\nheadless_cols = 140\nheadless_rows = 45\n[ui.sidebar.agents]\nrows = [["agent", "workspace", "tab"]]\n';
 const home=path.join(directory,'home'),temp=path.join(directory,'tmp');
 for(const dir of [path.dirname(configPath),home,temp])await mkdir(dir,{recursive:true,mode:0o700});
 await writeFile(configPath,original,{mode:0o600});await writeFile(path.join(home,'empty.gitconfig'),'');
 // Explicit allowlist: no user HOME, SSH agent, credential helper, provider key,
 // token, existing Herdr endpoint or other secret environment is propagated.
 const env={};for(const key of ['PATH','SystemRoot','SYSTEMROOT','WINDIR','ComSpec','COMSPEC','PATHEXT'])if(process.env[key])env[key]=process.env[key];
 Object.assign(env,{HOME:home,USERPROFILE:home,TMPDIR:temp,TEMP:temp,TMP:temp,XDG_CONFIG_HOME:configHome,XDG_STATE_HOME:stateHome,XDG_DATA_HOME:path.join(directory,'d'),HERDR_CONFIG_PATH:configPath,TERM:'xterm-256color',GIT_CONFIG_GLOBAL:path.join(home,'empty.gitconfig'),GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'credential.helper',GIT_CONFIG_VALUE_0:''});
 if(process.platform==='win32'){env.APPDATA=configHome;env.LOCALAPPDATA=path.join(directory,'local');}else env.SHELL='/bin/sh';
 const endpoint=path.join(configHome,'herdr','sessions',name,'herdr.sock'),cliEnv={...env,HERDR_SOCKET_PATH:endpoint};
 const handle=await open(path.join(proof,'server.log'),'w',0o600);
 const server=spawn(herdr,['--session',name,'server'],{cwd:directory,env,stdio:['ignore',handle.fd,handle.fd],windowsHide:true});let serverError;server.on('error',error=>{serverError=error;});
 const rpc=new HerdrClient(endpoint,{timeoutMs:2000});
 const raw=async(args,timeout=30000)=>exec(herdr,['--session',name,...args],{cwd:directory,env:cliEnv,encoding:'utf8',timeout,windowsHide:true,maxBuffer:4*1024*1024});
 const cli=async args=>JSON.parse((await raw(args)).stdout).result;
 const snapshot=async()=>(await rpc.call('session.snapshot')).snapshot;
 const registration=async()=>(await cli(['plugin','list','--plugin',pluginId,'--json'])).plugins;
 const evidence={kind:'actual-herdr-github-marketplace',ok:false,pluginId,repo,ref:ref??null,expectedCommit:expectedCommit??null,platform:process.platform,arch:process.arch,node:process.version,directory,checks:{},limits:['Exact Herdr0.9.3 contract: no plugin update command; updates use explicit deactivation, reinstall and reactivation.','Ordinary uninstall unregisters and removes the GitHub checkout but retains plugin config/state; isolated harness cleanup is separate.','Headless actual RPC/layout checks do not certify sidebar pixels; no paid providers are invoked.']};
 const save=async()=>writeFile(path.join(proof,'github.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 const stage=async(label,run)=>{console.log(JSON.stringify({stage:label,status:'running'}));evidence.checks[label]=await run();await save();console.log(JSON.stringify({stage:label,status:'passed'}));};
 let configDir,stateDir,pluginRoot,store,controller,originalPane,registered=false;const collectors=new Set();
 const owned=async value=>{assert.equal(typeof value,'string');const real=await realpath(value);assert.ok(inside(await realpath(directory),real),'Returned Herdr directory must be inside the disposable harness root');assert.ok((await lstat(value)).isDirectory());return real;};
 const action=async actionId=>{const invoked=(await cli(['plugin','action','invoke',actionId,'--plugin',pluginId])).log;assert.equal(invoked.plugin_id,pluginId);assert.equal(invoked.action_id,actionId);const entry=await until(actionId+' exact action completion',async()=>{const log=(await cli(['plugin','log','list','--plugin',pluginId,'--limit','256'])).logs.find(l=>l.log_id===invoked.log_id&&l.plugin_id===pluginId&&l.action_id===actionId);if(log?.status==='failed')throw Error(log.stderr||log.error||`Action ${actionId} failed`);if(log?.status==='succeeded'){assert.equal(log.exit_code,0);return log;}},30000);return {logId:entry.log_id,value:JSON.parse(entry.stdout)};};
 const ready=async()=>{controller=await until('authenticated ready collector',async()=>{const marker=await store.read('controller');if(!marker?.terminalId||!Number.isSafeInteger(marker.pid)||typeof marker.token!=='string')return;const health=await new MailboxClient(store.dir,marker.token,2000).request('ping');return health.ready===true&&health.stale===false&&marker;});collectors.add(controller.pid);const current=await snapshot();assert.equal(current.focused_pane_id,originalPane.pane_id);assert.ok(current.panes.some(p=>p.terminal_id===originalPane.terminal_id));const dashboard=current.panes.find(p=>p.terminal_id===controller.terminalId);assert.ok(dashboard);const layout=current.layouts.find(l=>l.tab_id===originalPane.tab_id),shellRect=layout?.panes.find(p=>p.pane_id===originalPane.pane_id)?.rect,panelRect=layout?.panes.find(p=>p.pane_id===dashboard.pane_id)?.rect;assert.ok(shellRect&&panelRect&&panelRect.x>=shellRect.x+shellRect.width,'Dashboard split is right of original shell');return{authenticatedReady:true,rightSplit:true,originalShellAndFocusPreserved:true};};
 const deactivate=async()=>{const result=await action('deactivate');assert.equal(result.value.deactivated,true);assert.deepEqual(result.value.conflicts,[]);await until('collector marker removed',async()=>!(await store.read('controller')));const current=await snapshot();assert.equal(current.panes.length,1);assert.equal(current.panes[0].terminal_id,originalPane.terminal_id);for(const pid of collectors)await until('owned collector stopped',async()=>{try{process.kill(pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}});assert.equal(await readFile(configPath,'utf8'),original);return{exactActionLog:result.logId,configBytesRestored:true,collectorsStopped:true,originalShellPreserved:true};};
 try{
  await stage('isolatedServer',async()=>{await until('own server startup',async()=>{if(serverError)throw serverError;if(server.exitCode!==null)throw Error('Own server exited '+server.exitCode);return snapshot();});const version=(await exec(herdr,['--version'],{env,encoding:'utf8'})).stdout.trim();assert.match(version,/^herdr 0\.9\.3\b/,'This harness asserts the verified Herdr0.9.3 install/reinstall/uninstall contract');const created=await cli(['workspace','create','--cwd',directory,'--label','GitHub install acceptance','--focus']);originalPane=created.root_pane;return{version,endpoint,environment:'Allowlisted non-secret keys; own HOME, Git config, temp and XDG namespaces'};});
  // Preseed only the isolated plugin namespace. Even a no-session shell collector
  // receives fixture-only provider homes rather than reading the user's history.
  configDir=await owned((await raw(['plugin','config-dir',pluginId])).stdout.trim());
  const providerHomes={};for(const provider of ['codex','claude','pi']){providerHomes[provider]=path.join(directory,'providers',provider);await mkdir(providerHomes[provider],{recursive:true,mode:0o700});}
  await writeFile(path.join(configDir,'settings.json'),JSON.stringify({nativeMode:'overview',providerHomes,todosEnabled:false,sampleIntervalMs:2000,follow:true,ascii:false,monochrome:false}),{mode:0o600});
  const installArgs=['plugin','install',repo,...(ref?['--ref',ref]:[]),'--yes'];
  await stage('normalGithubInstall',async()=>{const result=await raw(installArgs,180000);await writeFile(path.join(proof,'install.stdout.log'),result.stdout);await writeFile(path.join(proof,'install.stderr.log'),result.stderr);const plugins=await registration();assert.equal(plugins.length,1);const plugin=plugins[0];registered=true;assert.equal(plugin.plugin_id,pluginId);assert.equal(plugin.enabled,true);assert.equal(plugin.source.kind,'github');const [owner,repoName]=repo.split('/');assert.equal(plugin.source.owner,owner);assert.equal(plugin.source.repo,repoName);assert.match(plugin.source.resolved_commit,/^[a-f0-9]{40}$/);if(expectedCommit)assert.equal(plugin.source.resolved_commit,expectedCommit);if(ref)assert.equal(plugin.source.requested_ref,ref);pluginRoot=await owned(plugin.plugin_root);const checker=await import(pathToFileURL(path.join(pluginRoot,'scripts/check-install.mjs')).href);const checked=await checker.checkInstall({root:pluginRoot});assert.equal(checked.ok,true,checked.errors?.join('\n'));assert.ok(plugin.build?.some(b=>b.command?.includes('scripts/check-install.mjs')),'Registered manifest has the verified compiled-artifact build hook');evidence.resolvedCommit=plugin.source.resolved_commit;return{githubSource:true,resolvedCommit:plugin.source.resolved_commit,pluginRoot,buildHook:plugin.build,compiledFilesChecked:true,hostHelper:checked.helper??{backend:'Linux /proc; no native helper required'},installCommand:installArgs};});
  await stage('activateReady',async()=>{const result=await action('activate-overview');assert.equal(result.value.activated,true);assert.deepEqual(result.value.conflicts,[]);assert.equal(await owned(result.value.configDir),configDir);stateDir=await owned(result.value.stateDir);store=new StateStore(path.join(stateDir,'servers',identityName(endpoint)));return{exactActionLog:result.logId,...await ready()};});
  await stage('deactivateBeforeReinstall',deactivate);
  await stage('sameCommitReinstall',async()=>{const previous=(await registration())[0],sentinel=path.join(pluginRoot,'.prism-harness-old-generation');await writeFile(sentinel,'Own disposable checkout sentinel\n');const result=await raw(installArgs,180000);await writeFile(path.join(proof,'reinstall.stdout.log'),result.stdout);await writeFile(path.join(proof,'reinstall.stderr.log'),result.stderr);const next=(await registration())[0];assert.equal(next.source.resolved_commit,previous.source.resolved_commit,'Reviewed same-ref reinstall resolved same commit');pluginRoot=await owned(next.plugin_root);await assert.rejects(lstat(path.join(pluginRoot,'.prism-harness-old-generation')),error=>error.code==='ENOENT');assert.equal(await readFile(configPath,'utf8'),original);assert.equal((await snapshot()).panes.length,1);assert.equal(await store.read('controller'),undefined);return{resolvedCommitUnchanged:true,checkoutReplaced:true,deactivatedBeforeReplacement:true,noLifecycleContinuityClaim:true,supportedCommand:'plugin install (Herdr0.9.3 has no plugin update)'};});
  await stage('reactivateAndExplicitRestart',async()=>{await action('activate-overview');await ready();const prior=controller;const result=await action('activate-overview');const current=await ready();assert.notEqual(controller.terminalId,prior.terminalId);assert.notEqual(controller.pid,prior.pid);assert.ok(!(await snapshot()).panes.some(p=>p.terminal_id===prior.terminalId));assert.equal((await snapshot()).panes.length,2);return{...current,exactRestartActionLog:result.logId,oldOwnedPaneClosed:true,newCollector:true};});
  await stage('disableEnable',async()=>{await deactivate();await cli(['plugin','disable',pluginId]);assert.equal((await registration())[0].enabled,false);await assert.rejects(raw(['plugin','action','invoke','activate-overview','--plugin',pluginId]),error=>/disabled|not enabled/i.test(String(error.stdout)+String(error.stderr)+error.message));await cli(['plugin','enable',pluginId]);assert.equal((await registration())[0].enabled,true);await action('activate-overview');return{registrationDisabled:true,disabledActionRejected:true,registrationEnabled:true,...await ready(),explicitDeactivationBeforeDisable:true};});
  await stage('deactivateAndOrdinaryUninstall',async()=>{const stopped=await deactivate();const oldRoot=pluginRoot;const result=await raw(['plugin','uninstall',repo]);await writeFile(path.join(proof,'uninstall.stdout.log'),result.stdout);assert.equal((await registration()).length,0);await assert.rejects(lstat(oldRoot),error=>error.code==='ENOENT');for(const dir of [configDir,stateDir])assert.ok((await lstat(dir)).isDirectory(),'Herdr0.9.3 retains plugin user config/state');assert.equal(await readFile(configPath,'utf8'),original);const final=await snapshot();assert.equal(final.panes.length,1);assert.equal(final.panes[0].terminal_id,originalPane.terminal_id);registered=false;return{...stopped,uninstalledByOwnerRepo:true,registryRemoved:true,githubCheckoutRemoved:true,configAndStateRetainedByHerdr:true,bareCliCompletePurge:false};});
  evidence.ok=true;await save();return evidence;
 }catch(error){evidence.error=error.stack??String(error);try{evidence.failureSnapshot=await snapshot();evidence.failureLogs=(await cli(['plugin','log','list','--plugin',pluginId,'--limit','64'])).logs;}catch{}await save();throw error;}
 finally{
  // Even failures are confined to this namespace. Stop its live runtime and Herdr
  // before removing the entire temporary root, including Herdr's retained data.
  if(registered){try{await action('deactivate');}catch{}try{await raw(['plugin','uninstall',repo]);}catch{}}
  try{if(server.exitCode===null)await raw(['server','stop']);}catch{if(server.exitCode===null)server.kill('SIGTERM');}
  if(server.exitCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>{server.kill('SIGKILL');resolve();},5000);server.once('exit',()=>{clearTimeout(timer);resolve();});});
  rpc.close();await handle.close();
  const stillLive=[];for(const pid of collectors){try{process.kill(pid,0);stillLive.push(pid);}catch(error){if(error.code!=='ESRCH')stillLive.push(pid);}}
  if(stillLive.length){evidence.cleanup={temporaryRootRemoved:false,reason:'Own collector still live or uncertain',pids:stillLive};await save();throw Error('Own temporary root retained because a collector is still live or uncertain');}
  await rm(directory,{recursive:true,force:true});evidence.cleanup={ownServerStopped:true,temporaryRootRemoved:true,retainedHerdrDataRemovedOnlyFromHarnessRoot:true};await save();
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let i=2;i<process.argv.length;i++){const arg=process.argv[i];if(!['--repo','--ref','--expected-commit','--herdr','--proof'].includes(arg)||!process.argv[i+1])throw Error('Use [--repo OWNER/REPO] [--ref REF] [--expected-commit SHA] [--herdr BIN] [--proof DIR]');options[arg==='--expected-commit'?'expectedCommit':arg.slice(2)]=process.argv[++i];}
 try{console.log(JSON.stringify(await githubHerdrTest(options),null,2));}catch(error){console.error(error.stack??String(error));process.exitCode=1;}
}
