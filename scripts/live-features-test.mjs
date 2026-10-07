import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,appendFile,open,lstat,rm,readdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const exec=promisify(execFile);
const project=fileURLToPath(new URL('..',import.meta.url));
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
async function until(label,probe,timeoutMs=12000){const deadline=Date.now()+timeoutMs;let last;while(Date.now()<deadline){try{const value=await probe();if(value)return value;}catch(error){last=error;}await delay(100);}throw new Error(`${label} timed out${last?': '+last.message:''}`);}

/** Actual isolated Herdr acceptance with explicitly synthetic provider records.
 * All control targets this harness's named server, XDG roots and returned IDs.
 * No provider command, network request, paid model or user configuration is used.
 */
export async function liveFeaturesTest({release,herdr=process.env.HERDR_BIN_PATH??'herdr',proof=path.join(project,'artifacts/live-features-proof'),references=false}={}){
 if(!release)throw new Error('--release must name a reviewed checksummed release');
 release=path.resolve(release);proof=path.resolve(proof);
 const load=file=>import(pathToFileURL(path.join(release,file)).href);
 const {liveInstall,liveUninstall,pluginId}=await load('scripts/live-install.mjs');
 const {HerdrClient}=await load('dist/herdr/client.js');
 const {StateStore,identityName}=await load('dist/state/store.js');
 const {MailboxClient}=await load('dist/state/mailbox.js');
 const {Collector}=await load('dist/runtime/collector.js');
 const {NativePublisher}=await load('dist/native/publisher.js');
 const {NotesStore}=await load('dist/state/notes.js');
 const directory=await mkdtemp(path.join(process.platform==='win32'?os.tmpdir():'/tmp','hpf-'));
 await mkdir(proof,{recursive:true});
 const name='features',configHome=path.join(directory,'c'),configPath=path.join(configHome,'herdr','config.toml');
 const providerHomes={codex:path.join(directory,'provider-codex'),claude:path.join(directory,'provider-claude'),pi:path.join(directory,'provider-pi')};
 for(const dir of [path.dirname(configPath),...Object.values(providerHomes)])await mkdir(dir,{recursive:true,mode:0o700});
 const original='[server]\nheadless_cols = 160\nheadless_rows = 50\n[ui.sidebar.agents]\nrows = [["agent", "workspace", "tab"]]\n';
 await writeFile(configPath,original,{mode:0o600});
 // This location is Herdr's documented dedicated plugin config namespace. Cleanup
 // uses only the authenticated directory paths returned by the managed wrapper.
 const settingsDir=path.join(configHome,'herdr','plugins','config',pluginId);
 await mkdir(settingsDir,{recursive:true,mode:0o700});
 const settings={nativeMode:'overview',providerHomes,todosEnabled:false,sampleIntervalMs:2000,follow:true,ascii:false,monochrome:false};
 await writeFile(path.join(settingsDir,'settings.json'),JSON.stringify(settings),{mode:0o600});
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('HERDR_'))delete env[key];
 Object.assign(env,{XDG_CONFIG_HOME:configHome,XDG_STATE_HOME:path.join(directory,'s'),XDG_DATA_HOME:path.join(directory,'d'),HERDR_CONFIG_PATH:configPath,TERM:'xterm-256color',PI_CODING_AGENT_DIR:providerHomes.pi,CLAUDE_CONFIG_DIR:providerHomes.claude,CODEX_HOME:providerHomes.codex});
 if(process.platform==='win32'){env.APPDATA=configHome;env.LOCALAPPDATA=path.join(directory,'local');}else env.SHELL='/bin/sh';
 const endpoint=path.join(configHome,'herdr','sessions',name,'herdr.sock');
 const handle=await open(path.join(proof,'server.log'),'w',0o600);
 const server=spawn(herdr,['--session',name,'server'],{cwd:directory,env,stdio:['ignore',handle.fd,handle.fd],windowsHide:true});let serverError;server.on('error',error=>{serverError=error;});
 const rpc=new HerdrClient(endpoint,{timeoutMs:3000});
 const managedDir=path.join(directory,'managed');
 const options={root:release,managedDir,herdrBin:herdr,herdrPrefix:['--session',name],env:{...env,HERDR_SOCKET_PATH:endpoint},timeoutMs:30000};
 const cli=async args=>{const output=await exec(herdr,['--session',name,...args],{env:options.env,cwd:directory,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:4*1024*1024});return output.stdout.trim()?JSON.parse(output.stdout).result:{};};
 const snapshot=async()=>(await rpc.call('session.snapshot')).snapshot;
 const pane=async id=>(await rpc.call('pane.get',{pane_id:id})).pane;
 const text=async id=>(await exec(herdr,['--session',name,'pane','read',id,'--source','visible','--lines','60'],{env:options.env,cwd:directory,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:4*1024*1024})).stdout;
 const source=`plugin:${pluginId}`;
 const evidence={kind:'actual-isolated-herdr-features',ok:false,pluginId,platform:process.platform,arch:process.arch,node:process.version,release,directory,fixtureNotice:'Synthetic Pi-shaped version-3 records and idle Node fixtures with explicit process.title=pi; no paid provider or provider-version compatibility claim.',checks:{},limits:['Headless server and actual terminal readback; native sidebar pixels and multi-client renderer differences are not certified.','Hidden transcript/body pause is observed; Native cards keep verified Self+jobs CPU and cumulative RSS/WS live on each platform. Internal Git/process read counts are not directly instrumented.']};
 const save=async()=>writeFile(path.join(proof,'features.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 const stage=async(label,run)=>{console.log(JSON.stringify({stage:label,status:'running'}));const value=await run();evidence.checks[label]=value;await save();console.log(JSON.stringify({stage:label,status:'passed'}));return value;};
 let installed,store,controller,pausedPid,probeCollector,success=false;
 try{
  await stage('isolatedServer',async()=>{await until('dedicated server startup',async()=>{if(serverError)throw serverError;if(server.exitCode!==null)throw new Error('Dedicated server exited '+server.exitCode);return snapshot();});return{version:(await exec(herdr,['--version'],{env,encoding:'utf8'})).stdout.trim(),endpoint};});
  // Herdr0.9.3 uses Linux comm before unwrapping generic runtimes. Node24 names its
  // main thread MainThread, so a script basename alone is not a portable identity.
  // Name only this explicitly synthetic child; detection still observes the real process.
  const fixtureCli=path.join(directory,'fixtures','pi');await mkdir(path.dirname(fixtureCli),{recursive:true});await writeFile(fixtureCli,"process.title='pi';console.log('SYNTHETIC FIXTURE ONLY; no model');process.stdin.resume();process.stdin.on('data',bytes=>{if(String(bytes).includes('FIXTURE_CPU_BURST')){console.log('SYNTHETIC CPU BURST STARTED');const deadline=Date.now()+6000;const burn=setInterval(()=>{if(Date.now()>=deadline){clearInterval(burn);return;}const until=Date.now()+20;while(Date.now()<until){}},50);}});process.stdin.on('end',()=>process.exit(0));setInterval(()=>{},1000);\n");
  const fixtureDirectory=path.join(providerHomes.pi,'sessions','fixture-project');await mkdir(fixtureDirectory,{recursive:true});
  const fixture=async id=>{const file=path.join(fixtureDirectory,id+'.jsonl');await writeFile(file,[{type:'session',version:3,id,cwd:directory,timestamp:new Date().toISOString()},{type:'session_info',id:'info',name:id},{type:'message',id:id+'-first',timestamp:new Date().toISOString(),message:{role:'assistant',content:[{type:'text',text:'SYNTHETIC '+id+' FIRST MESSAGE'}],stopReason:'stop'}}].map(row=>JSON.stringify(row)+'\n').join(''));return file;};
  const alphaFile=await fixture('fixture-alpha'),betaFile=await fixture('fixture-beta');
  const created=await cli(['workspace','create','--cwd',directory,'--label','Synthetic feature fixtures','--focus']);
  const alpha=created.root_pane,beta=(await cli(['tab','create','--workspace',created.workspace.workspace_id,'--cwd',directory,'--label','Fixture beta','--no-focus'])).root_pane;
  const report=async(target,file,seq)=>{await rpc.call('pane.report_agent',{pane_id:target.pane_id,source:'herdr:pi',agent:'pi',state:'working',agent_session_path:file,seq});await rpc.call('pane.report_agent_session',{pane_id:target.pane_id,source:'herdr:pi',agent:'pi',agent_session_path:file,session_start_source:'startup',seq:seq+1});};
  await stage('explicitFixtureSessions',async()=>{for(const[target,file,label]of [[alpha,alphaFile,'fixture-alpha'],[beta,betaFile,'fixture-beta']]){const command=process.platform==='win32'?`& ${"'"+process.execPath.replaceAll("'","''")+"'"} ${"'"+fixtureCli.replaceAll("'","''")+"'"} --session ${"'"+file.replaceAll("'","''")+"'"}`:`exec ${quote(process.execPath)} ${quote(fixtureCli)} --session ${quote(file)}`;await cli(['pane','run',target.pane_id,command]);await until('idle fixture detected as pi',async()=>{const agent=(await snapshot()).agents.find(a=>a.terminal_id===target.terminal_id);return agent?.agent==='pi'&&agent;});await report(target,file,100);await until('dedicated session report attached',async()=>{const agent=(await snapshot()).agents.find(a=>a.terminal_id===target.terminal_id);return agent?.agent_session?.kind==='path'&&agent.agent_session.value===file&&agent;});await cli(['agent','rename',target.pane_id,label]);}return{alpha:{paneId:alpha.pane_id,terminalId:alpha.terminal_id,session:alphaFile},beta:{paneId:beta.pane_id,terminalId:beta.terminal_id,session:betaFile},reportMethods:['pane.report_agent','pane.report_agent_session']};});
  await rpc.call('agent.focus',{target:alpha.pane_id});
  installed=await liveInstall(options);store=new StateStore(path.join(installed.stateDir,'servers',identityName(endpoint)));controller=await store.read('controller');assert.ok(controller?.terminalId&&controller.pid);assert.equal(installed.configDir,settingsDir,'fixture-only provider homes are loaded from exact Herdr namespace');
  const ownPane=async(tabId,targetTerminalId)=>{const current=await snapshot(),views=await store.read('views')??[];return current.panes.find(p=>p.tab_id===(tabId??current.focused_tab_id)&&views.some(v=>v.open&&v.terminalId===p.terminal_id&&(targetTerminalId===undefined||v.targetTerminalId===targetTerminalId)));};
  let nativePrefix;
  await stage('nativeMetadataReadback',async()=>{const value=await until('native fixture publication',async()=>{const p=await pane(alpha.pane_id);const line=Object.keys(p.tokens??{}).find(k=>/^(hat|prism)_line$/.test(k));if(!line)return;nativePrefix=line.slice(0,-5);return p.tokens[line].includes('fixture-alpha')&&p.tokens[nativePrefix+'_last']?.includes('FIRST MESSAGE')&&p;});const keys=Object.keys(value.tokens).filter(k=>k.startsWith(nativePrefix+'_'));assert.ok(keys.length<=16);for(const key of ['line','load','counts','branch','div','last','rank'])assert.equal(typeof value.tokens[nativePrefix+'_'+key],'string');assert.equal((await snapshot()).focused_pane_id,alpha.pane_id);return{tokenPrefix:nativePrefix,nonemptyKeys:keys,emptyTokensOmittedByHerdr:true,budgetAtMost16:true,focusedFixturePreserved:true};});
  const token=name=>nativePrefix+'_'+name;
  const rightOf=async target=>{const current=await snapshot(),panel=await ownPane(target.tab_id,target.terminal_id);if(panel?.tab_id!==target.tab_id)return;const layout=current.layouts.find(l=>l.tab_id===target.tab_id),agentRect=layout?.panes.find(p=>p.pane_id===target.pane_id)?.rect,panelRect=layout?.panes.find(p=>p.pane_id===panel.pane_id)?.rect;return agentRect&&panelRect&&panelRect.x>=agentRect.x+agentRect.width&&panel;};
  await stage('independentPanelsAndPin',async()=>{
   const alphaPanel=await until('initial right placement',()=>rightOf(alpha));
   await rpc.call('agent.focus',{target:beta.pane_id});
   const action=(await cli(['plugin','action','invoke','open','--plugin',pluginId])).log;
   await until('beta open succeeds',async()=>{const entry=(await cli(['plugin','log','list','--plugin',pluginId,'--limit','64'])).logs.find(l=>l.log_id===action.log_id);if(entry?.status==='failed')throw Error(entry.stderr||entry.error);return entry?.status==='succeeded';});
   const betaPanel=await until('independent beta right panel',()=>rightOf(beta));
   assert.notEqual(alphaPanel.terminal_id,betaPanel.terminal_id);
   await until('beta reader',async()=>(await text(betaPanel.pane_id)).includes('fixture-beta'));
   // The header is inventory metadata and can render before the first visible
   // transcript pass. Establish a hydrated baseline before hiding this view;
   // otherwise this probe can mistake an uncollected body for paused content.
   await until('visible beta transcript publication',async()=>(await pane(beta.pane_id)).tokens?.[token('last')]?.includes('FIRST MESSAGE'));
   await cli(['pane','send-text',betaPanel.pane_id,'p']);await until('pin keyboard applied',async()=>(await text(betaPanel.pane_id)).includes('Pinned'));
   await rpc.call('agent.focus',{target:alpha.pane_id});await delay(1800);
   assert.equal((await ownPane(alpha.tab_id,alpha.terminal_id)).terminal_id,alphaPanel.terminal_id);
   assert.equal((await ownPane(beta.tab_id,beta.terminal_id)).terminal_id,betaPanel.terminal_id);
   assert.ok((await text(betaPanel.pane_id)).includes('fixture-beta'));
   return{rightPlacement:true,independentTabPanels:true,pinRetainsBetaReader:true,otherPanelPreserved:true,sharedCollectorPid:controller.pid};
  });
  await stage('hiddenPauseAndResume',async()=>{
   const before=await pane(beta.pane_id);assert.ok(before.tokens?.[token('last')]?.includes('FIRST MESSAGE'));
   assert.notEqual((await snapshot()).focused_tab_id,beta.tab_id,'the beta inspector must be hidden during this probe');
   await appendFile(betaFile,JSON.stringify({type:'message',id:'hidden-message',timestamp:new Date().toISOString(),message:{role:'assistant',content:[{type:'text',text:'SYNTHETIC HIDDEN MESSAGE'}],stopReason:'stop'}})+'\n');
   let hidden;
   // The hidden transcript remains paused while one shared host batch keeps
   // native Self+jobs CPU and cumulative RSS/WS current on every platform.
   await cli(['pane','send-text',beta.pane_id,'FIXTURE_CPU_BURST'+(process.platform==='win32'?'\r':'\n')]);
   await until('synthetic CPU burst input delivered',async()=>(await text(beta.pane_id)).includes('SYNTHETIC CPU BURST STARTED'));
   hidden=await until('hidden native Self+jobs CPU remains live',async()=>{
    const value=await pane(beta.pane_id);assert.equal(value.tokens?.[token('last')],before.tokens[token('last')],'hidden body must remain paused throughout the resource probe');
    const cpu=/^CPU ≥?([\d.,]+)%/.exec(value.tokens?.[token('load')]??'');
    return cpu&&Number(cpu[1].replaceAll(',',''))>1&&value.tokens?.[token('load')]!==before.tokens[token('load')]&&[undefined,'','partial'].includes(value.tokens?.[token('fresh')])&&value;
   },12000);
   assert.match(hidden.tokens[token('load')],/^CPU ≥?[\d.,]+%  (?:RSS|WS) (?!—)/);assert.match(hidden.tokens[token('counts')],/^p1 /);
   assert.equal(hidden.tokens[token('last')],before.tokens[token('last')]);assert.notEqual((await snapshot()).focused_tab_id,beta.tab_id);
   await cli(['tab','focus',beta.tab_id]);await until('visible fixture body resumes',async()=>(await pane(beta.pane_id)).tokens?.[token('last')]?.includes('HIDDEN MESSAGE'));
   return{newBodyNotHydratedWhileHidden:true,bodyHydratedAfterVisible:true,resourcePolicy:'live verified Self+jobs CPU and cumulative RSS/WS',cachedInspectorResources:false,boundedSyntheticCpuBurstObservedWhileHidden:true,beforeHiddenLoad:before.tokens[token('load')],hiddenLoad:hidden.tokens[token('load')]};
  });
  if(references)await stage('referenceHistoryNavigation',async()=>{
   const base=Date.now()-100000,record=(id,body,at)=>({type:'message',id,timestamp:new Date(at).toISOString(),message:{role:'assistant',content:[{type:'text',text:body}],stopReason:'stop'}});
   await mkdir(path.join(directory,'src'),{recursive:true});await writeFile(path.join(directory,'src','shared.ts'),'SYNTHETIC REFERENCE FIXTURE\n');
   const rows=[...Array.from({length:150},(_,i)=>record('beta-mention-'+i,'SYNTHETIC MENTION '+i+' of `src/shared.ts`',base+i)),{type:'message',id:'beta-write-call',timestamp:new Date(base+151).toISOString(),message:{role:'assistant',content:[{type:'toolCall',id:'write-shared',name:'write',arguments:{path:'src/shared.ts'}}],stopReason:'toolUse'}},{type:'message',id:'beta-write-result',timestamp:new Date(base+152).toISOString(),message:{role:'toolResult',toolCallId:'write-shared',content:[{type:'text',text:'Success'}]}},...Array.from({length:2105},(_,i)=>record('beta-ref-'+i,'See `src/ref-'+i+'.ts`',base+200+i))];
   await appendFile(betaFile,rows.map(row=>JSON.stringify(row)+'\n').join(''));await until('bounded historical reference publication',async()=>/r2000\+/.test((await pane(beta.pane_id)).tokens?.[token('counts')]??''));
   const panel=await ownPane(beta.tab_id,beta.terminal_id),send=value=>cli(['pane','send-text',panel.pane_id,value]),screen=()=>text(panel.pane_id);await send('\t\t\t\t\t\t');await until('Refs tab selected',async()=>/\[Refs\]|< Refs >/.test(await screen()));
   for(const count of [50,100,106]){await send('b');await until('older target page '+count,async()=>new RegExp(count+' loaded').test(await screen()));}
   await send('Gk');await until('recovered target shows explicit successful edit evidence',async()=>/✎[^\n]*shared\.ts/.test(await screen()));await send(' ');await until('source history opened for the oldest recovered target',async()=>{const value=await screen();return value.includes('shared.ts')&&value.includes('50 mention sources');});
   for(const count of [100,150]){await send('b');await until('older source page '+count,async()=>(await screen()).includes(count+' mention sources'));}
   await send('Gk\r');await until('exact first mention source opened',async()=>(await screen()).includes('SYNTHETIC MENTION 0 of'));await send('\x1b');await until('return to source reader anchor',async()=>{const value=await screen();return value.includes('beta-mention-0')&&value.includes('End of mention history');});await send('\x1b');await until('return to older reference target anchor',async()=>{const value=await screen();return value.includes('shared.ts')&&value.includes('End of target history');});
   await send('\t\t');await until('Overview restored after reference fixture',async()=>/\[Overview\]|< Overview >/.test(await screen()));
   return{targetsInFixture:2106,hotTargets:2000,olderTargetsRecovered:106,mentionsRecovered:150,exactFirstSourceOpened:true,sourceAndTargetAnchorsRestored:true,actualInspectorKeyboardAndHerdrPTY:true,explicitSuccessfulEditFixture:true};
  });
  await stage('persistentNotesAndEditHold',async()=>{
   let panel=await ownPane(beta.tab_id,beta.terminal_id);const screen=()=>text(panel.pane_id),send=value=>cli(['pane','send-text',panel.pane_id,value]);
   await send('p');await until('Notes follow enabled',async()=>(await screen()).includes('Follow'));
   // Activate the drawn Notes arrow. Headless PTY dimensions can differ from
   // layout rectangles, so test the actual displayed hit target rather than
   // assuming a column order or a global End shortcut.
   const overview=(await screen()).split('\n'),noteLine=overview.findIndex(line=>/│[^\n]*\bNotes\s/.test(line)),noteColumn=noteLine<0?-1:overview[noteLine].indexOf('→',overview[noteLine].indexOf('Notes'));
   assert.ok(noteLine>=0&&noteColumn>=0,'Overview Notes arrow is drawn');
   await send(`\x1b[<0;${noteColumn+1};${noteLine+1}M\x1b[<0;${noteColumn+1};${noteLine+1}m`);await until('Notes selected through Overview link',async()=>(await screen()).includes('[Notes]'));
   await send('\r');await until('Notes editing',async()=>(await screen()).includes('Editing'));
   const markdown='# Persistent notes\n\nq and p are literal text.\n';await send('\x1b[200~'+markdown+'\x1b[201~');
   const gamma=(await cli(['pane','split',beta.pane_id,'--direction','down','--no-focus'])).pane,gammaFile=await fixture('fixture-gamma');
   const command=process.platform==='win32'?`& ${"'"+process.execPath.replaceAll("'","''")+"'"} ${"'"+fixtureCli.replaceAll("'","''")+"'"} --session ${"'"+gammaFile.replaceAll("'","''")+"'"}`:`exec ${quote(process.execPath)} ${quote(fixtureCli)} --session ${quote(gammaFile)}`;
   await cli(['pane','run',gamma.pane_id,command]);await until('same-tab gamma detected',async()=>(await snapshot()).agents.some(a=>a.terminal_id===gamma.terminal_id&&a.agent==='pi'));await report(gamma,gammaFile,300);await rpc.call('agent.focus',{target:gamma.pane_id});
   const noteDir=path.join(store.dir,'notes',identityName('pi:fixture-beta')),notePath=path.join(noteDir,'note.md');
   await until('autosaved beta Markdown',async()=>await readFile(notePath,'utf8')===markdown);
   const held=await screen();assert.ok(held.includes('fixture-beta')&&held.includes('Editing'));assert.ok(!held.split('\n')[0].includes('fixture-gamma'));
   await send('\x13\x1b');await until('neighbor focus does not change beta Notes after editing',async()=>{const value=await screen();return value.includes('q and p are literal text.')&&!value.includes('Editing');});await delay(1800);
   assert.ok((await screen()).includes('q and p are literal text.'),'refresh after ending edit must not follow another native pane');assert.equal((await snapshot()).focused_pane_id,gamma.pane_id);
   const notesStore=new NotesStore(store.dir),gammaMarkdown='# Gamma conversation notes\n\nSYNTHETIC GAMMA NOTE\n';await notesStore.save('pi:fixture-gamma',gammaMarkdown,null);
   await send('\r');await until('beta Notes editing before its bound conversation changes',async()=>(await screen()).includes('Editing'));
   await report(beta,gammaFile,400);await until('bound beta terminal reports gamma conversation',async()=>(await pane(beta.pane_id)).agent_session?.value===gammaFile);await delay(1800);
   const boundHeld=await screen();assert.ok(boundHeld.includes('Editing')&&boundHeld.includes('q and p are literal text.'));assert.ok(!boundHeld.includes('SYNTHETIC GAMMA NOTE'));assert.equal(await readFile(notePath,'utf8'),markdown);
   await send('\x13\x1b');await until('bound conversation follows after editing ends',async()=>{const value=await screen();return value.includes('SYNTHETIC GAMMA NOTE')&&!value.includes('Editing');});assert.equal((await notesStore.load('pi:fixture-gamma')).text,gammaMarkdown);assert.equal(await readFile(notePath,'utf8'),markdown);
   await report(beta,betaFile,500);await until('original bound beta conversation restored',async()=>(await pane(beta.pane_id)).agent_session?.value===betaFile);await until('beta Notes restored by its own binding',async()=>{const value=await screen();return value.includes('q and p are literal text.')&&!value.includes('SYNTHETIC GAMMA NOTE');});await delay(1800);assert.ok((await screen()).includes('q and p are literal text.'));assert.equal((await snapshot()).focused_pane_id,gamma.pane_id,'a neighbor may stay focused while this panel follows only beta');
   await send('\r');await until('Notes editor has captured its revision before an external edit',async()=>(await screen()).includes('Editing'));await writeFile(notePath,'External authoritative edit\n',{mode:0o600});await send('\x1b[200~Draft update\x1b[201~');await send('\x13');
   await until('conflicting draft recovered',async()=>(await screen()).includes('External edit preserved'));
   assert.equal(await readFile(notePath,'utf8'),'External authoritative edit\n');const drafts=(await readdir(noteDir)).filter(name=>name.startsWith('recovery-')&&name.endsWith('.md'));assert.equal(drafts.length,1);assert.ok((await readFile(path.join(noteDir,drafts[0]),'utf8')).includes('Draft update'));
   await send('\x1b[200~ before close\x1b[201~\x03');await until('Notes editing panel closed after flush',async()=>!(await snapshot()).panes.some(p=>p.terminal_id===panel.terminal_id));assert.ok((await readFile(path.join(noteDir,drafts[0]),'utf8')).includes('before close'));
   await rpc.call('agent.focus',{target:beta.pane_id});assert.equal((await snapshot()).focused_pane_id,beta.pane_id);
   const opened=(await cli(['plugin','action','invoke','open','--plugin',pluginId])).log;await until('Notes view reopened',async()=>{const entry=(await cli(['plugin','log','list','--plugin',pluginId,'--limit','64'])).logs.find(l=>l.log_id===opened.log_id);if(entry?.status==='failed')throw Error(entry.stderr||entry.error);return entry?.status==='succeeded';},30000);
   panel=await until('replacement beta Notes pane',()=>ownPane(beta.tab_id,beta.terminal_id));await until('persisted external Notes after restart',async()=>(await screen()).includes('External authoritative edit'));await send('\x1b[Z');await until('Overview restored after Notes',async()=>(await screen()).includes('[Overview]'));
   assert.equal((await store.read('controller')).pid,controller.pid);return{autosave:true,literalNavigationLetters:true,bracketedPaste:true,originalAgentHeldDuringSameTabFocusChange:true,neighborFocusIgnoredAfterEditing:true,boundConversationHeldDuringEditing:true,boundConversationFollowResumed:true,originalBindingNotesRestored:true,externalEditPreserved:true,recoveryDraftSaved:true,closeFlush:true,restartPersistence:true,sharedCollectorUnchanged:true};
  });
  await stage('livePanelTabOrderReload',async()=>{
   const panel=await ownPane(beta.tab_id,beta.terminal_id),send=value=>cli(['pane','send-text',panel.pane_id,value]),screen=()=>text(panel.pane_id),settingsPath=path.join(settingsDir,'settings.json');
   const saved=JSON.parse(await readFile(settingsPath,'utf8')),pid=controller.pid;
   const reload=async()=>{const log=(await cli(['plugin','action','invoke','reload-settings','--plugin',pluginId])).log;await until('panel settings reload completed',async()=>{const entry=(await cli(['plugin','log','list','--plugin',pluginId,'--limit','64'])).logs.find(l=>l.log_id===log.log_id);if(entry?.status==='failed')throw Error(entry.stderr||entry.error);return entry?.status==='succeeded';},30000);};
   await send('\t');await until('default second tab is Notes',async()=>(await screen()).includes('[Notes]'));await send('\r');await until('Notes editing before live reorder',async()=>(await screen()).includes('Editing'));
   await writeFile(settingsPath,JSON.stringify({...saved,ui:{...saved.ui,tabOrder:['Messages','Refs','Processes','Agents','Git','To-do','Notes','Overview']}}),{mode:0o600});await reload();
   await until('live reordered tabs preserve Notes editing',async()=>{const value=await screen();return /Messages\s+Refs\s+Processes\s+Agents\s+Git\s+To-do\s+\[Notes\]\s+Overview/.test(value)&&value.includes('Editing')&&value.includes('External authoritative edit');});
   assert.equal((await store.read('controller')).pid,pid);await send('\x1b');await writeFile(settingsPath,JSON.stringify(saved),{mode:0o600});await reload();
   await until('default order restored without leaving Notes',async()=>/Overview\s+\[Notes\]\s+To-do\s+Git\s+Agents\s+Processes\s+Refs\s+Messages/.test(await screen()));await send('\x1b[Z');await until('Overview after restored order',async()=>(await screen()).includes('[Overview]'));
   return{defaultNotesSecond:true,actualReloadAction:true,liveOrderChanged:true,notesEditingAndContentPreserved:true,collectorUnchanged:true,defaultRestored:true};
  });
  await stage('nativeMetadataExpiry',async()=>{if(process.platform==='win32'){
    // Stop the owned periodic publisher gracefully, then publish once through the
    // actual production publisher. This measures host expiry without suspension,
    // fake clocks, clearing the tested keys, or periodic renewal during the wait.
    const oldPid=controller.pid;await new MailboxClient(store.dir,controller.token).request('shutdown');
    await until('owned publisher stopped for TTL fixture',async()=>{if(await store.read('controller'))return false;try{process.kill(oldPid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}});
    probeCollector=new Collector({rpc,settings:{...settings,nativeMode:'inspector-only'},stateDir:path.join(directory,'ttl-probe'),paneOpen:false});await probeCollector.init();await probeCollector.refresh();
    const fixtureSession=probeCollector.data.sessions.find(s=>s.attachment?.terminal_id===beta.terminal_id);assert.ok(fixtureSession);
    await probeCollector.close({clearNative:false});probeCollector=undefined;
    await rpc.call('pane.report_metadata',{pane_id:beta.pane_id,source:'fixture.prism.ttl',tokens:{fixture_foreign:'preserve'},ttl_ms:60000,seq:1});
    const publisher=new NativePublisher(rpc);await publisher.publish([fixtureSession]);assert.equal(publisher.diagnostics.length,0);assert.equal(publisher.ownership().length,1);
    const published=await pane(beta.pane_id);assert.ok(published.tokens?.[token('line')]);const started=Date.now();
    const expired=await until('production publisher metadata TTL expiry',async()=>{const p=await pane(beta.pane_id);return Object.keys(p.tokens??{}).every(k=>!k.startsWith(nativePrefix+'_'))&&p;},22000);
    assert.equal(expired.agent,'pi');assert.ok(expired.workspace_id&&expired.tab_id&&expired.agent_session);assert.equal(expired.tokens.fixture_foreign,'preserve');
    const elapsedMs=Date.now()-started;const action=(await cli(['plugin','action','invoke','activate-overview','--plugin',pluginId])).log;
    await until('publisher restart after TTL fixture',async()=>{const entry=(await cli(['plugin','log','list','--plugin',pluginId,'--limit','64'])).logs.find(l=>l.log_id===action.log_id);if(entry?.status==='failed')throw Error(entry.stderr||entry.error);return entry?.status==='succeeded'&&entry.exit_code===0;},30000);
    controller=await store.read('controller');await until('native metadata renewed after TTL fixture',async()=>(await pane(beta.pane_id)).tokens?.[token('line')]);
    return{expiredAfterMs:elapsedMs,allPublishedNativeTokensExpired:true,builtinAgentWorkspaceTabFactsRetained:true,foreignMetadataRetained:true,resumed:true,method:'graceful owned publisher stop, one production NativePublisher write, actual host clock expiry, explicit restart'};
   }await rpc.call('pane.report_metadata',{pane_id:beta.pane_id,source:'fixture.prism.ttl',tokens:{fixture_foreign:'preserve'},ttl_ms:60000,seq:1});pausedPid=controller.pid;process.kill(pausedPid,'SIGSTOP');const started=Date.now();const expired=await until('15-second native metadata TTL expiry',async()=>{const p=await pane(beta.pane_id);return Object.keys(p.tokens??{}).every(k=>!k.startsWith(nativePrefix+'_'))&&p;},22000);assert.equal(expired.agent,'pi');assert.ok(expired.workspace_id&&expired.tab_id&&expired.agent_session);assert.equal(expired.tokens.fixture_foreign,'preserve');process.kill(pausedPid,'SIGCONT');pausedPid=undefined;await until('native metadata resumes after controlled suspension',async()=>(await pane(beta.pane_id)).tokens?.[token('line')]);return{expiredAfterMs:Date.now()-started,allPublishedNativeTokensExpired:true,builtinAgentWorkspaceTabFactsRetained:true,foreignMetadataRetained:true,resumed:true};});
  await stage('staleOccupantGuards',async()=>{probeCollector=new Collector({rpc,settings:{...settings,nativeMode:'inspector-only'},stateDir:path.join(directory,'focus-probe'),paneOpen:false});await probeCollector.init();await probeCollector.refresh();const old=probeCollector.data.sessions.find(s=>s.attachment?.terminal_id===beta.terminal_id);assert.ok(old);const replacement=await fixture('fixture-replacement');await report(beta,replacement,1000);await until('fixture occupant identity replaced',async()=>(await pane(beta.pane_id)).agent_session?.value===replacement);const focused=(await snapshot()).focused_pane_id;await assert.rejects(probeCollector.focus(old.key),/occupant changed|ended/);assert.equal((await snapshot()).focused_pane_id,focused);let writes=0;const observed={call:async(method,params)=>{if(method==='pane.report_metadata')writes++;return rpc.call(method,params);}};const publisher=new NativePublisher(observed);await publisher.publish([old]);assert.equal(writes,0);assert.equal(publisher.ownership().length,0);assert.ok(publisher.diagnostics.some(d=>/occupant changed/.test(d)));await probeCollector.close({clearNative:false});probeCollector=undefined;return{focusRejectedChangedSession:true,focusPreserved:true,publicationRejectedBeforeWrite:true};});
  await stage('closedViewPreservesCollector',async()=>{
   const panel=await ownPane(beta.tab_id,beta.terminal_id),oldPid=controller.pid,other=await ownPane(alpha.tab_id,alpha.terminal_id);
   await cli(['pane','send-text',panel.pane_id,'q']);
   await until('only current view closes',async()=>!(await snapshot()).panes.some(p=>p.terminal_id===panel.terminal_id));
   assert.equal((await store.read('controller')).pid,oldPid);assert.equal((await ownPane(alpha.tab_id,alpha.terminal_id)).terminal_id,other.terminal_id);
   await rpc.call('agent.focus',{target:beta.pane_id});assert.equal((await snapshot()).focused_pane_id,beta.pane_id);
   const action=(await cli(['plugin','action','invoke','open','--plugin',pluginId])).log;
   await until('replacement view opens',async()=>{const entry=(await cli(['plugin','log','list','--plugin',pluginId,'--limit','64'])).logs.find(l=>l.log_id===action.log_id);if(entry?.status==='failed')throw Error(entry.stderr||entry.error);return entry?.status==='succeeded';},30000);
   controller=await store.read('controller');assert.equal(controller.pid,oldPid);
   return{closedOnlyCurrentView:true,otherViewPreserved:true,singleSharedCollectorPreserved:true,reopenedForRemainingAcceptance:true};
  });
  await stage('projectionSourceGuardAndCoexistence',async()=>{const wrong=await rpc.call('agent.view.clear',{source:'fixture.prism.wrong-owner'});assert.equal(wrong.active,true);assert.equal(wrong.source,source);await rpc.call('agent.view.set',{source:'fixture.prism.foreign-owner',label:'Synthetic coexistence view',sort:[]});const retained=await rpc.call('agent.view.clear',{source});assert.equal(retained.active,true);assert.equal(retained.source,'fixture.prism.foreign-owner');return{wrongSourceCannotClearPluginView:true,pluginClearPreservesForeignFixtureView:true,fixtureIsNotRadarOrPiTreeCompatibility:true};});
  await stage('configConflictAndRecovery',async()=>{const configured=await readFile(configPath,'utf8');const goalToken='$'+token('load');assert.ok(configured.includes(goalToken));const extra='\n[fixture_user]\nretained = true\n';await writeFile(configPath,configured.replace(goalToken,'$fixture_user_edit')+extra,{mode:0o600});await assert.rejects(liveUninstall(options),/conflict|User-modified/i);assert.ok((await cli(['plugin','list','--plugin',pluginId,'--json'])).plugins.length);for(const dir of [managedDir,installed.configDir,installed.stateDir])assert.ok((await lstat(dir)).isDirectory());const conflicted=await readFile(configPath,'utf8');assert.ok(conflicted.includes('$fixture_user_edit')&&conflicted.includes('[fixture_user]'));await writeFile(configPath,conflicted.replace('$fixture_user_edit',goalToken),{mode:0o600});const removed=await liveUninstall(options);installed=undefined;assert.equal(removed.removed,true);assert.equal(await readFile(configPath,'utf8'),original+extra);const stillForeign=await rpc.call('agent.view.clear',{source:'fixture.prism.wrong-owner'});assert.equal(stillForeign.source,'fixture.prism.foreign-owner');await rpc.call('agent.view.clear',{source:'fixture.prism.foreign-owner'});return{conflictRefusedPurge:true,registrationAndOwnedDirectoriesRetained:true,userEditPreserved:true,explicitFixtureRecoveryUninstalled:true,originalConfigAndUnrelatedEditRestored:true,foreignProjectionSurvivedUninstall:true};});
  evidence.ok=true;success=true;await save();return evidence;
 }catch(error){evidence.error=error.stack??String(error);try{evidence.failureSnapshot=await snapshot();evidence.failurePaneText=[];for(const p of evidence.failureSnapshot.panes)evidence.failurePaneText.push({paneId:p.pane_id,text:await text(p.pane_id)});evidence.failurePluginLogs=(await cli(['plugin','log','list','--plugin',pluginId,'--limit','32'])).logs;}catch{}await save();throw error;}
 finally{
  if(pausedPid){try{process.kill(pausedPid,'SIGCONT');}catch{}}
  await probeCollector?.close({clearNative:false}).catch(()=>{});
  if(installed){try{await liveUninstall(options);}catch(error){evidence.cleanupError=String(error);await save();}}
  if(!success&&!installed){try{await lstat(path.join(managedDir,'.hat-managed-install.json'));await liveUninstall(options);}catch(error){if(error.code!=='ENOENT'){evidence.cleanupError=String(error);await save();}}}
  try{if(server.exitCode===null)await cli(['server','stop']);}catch{if(server.exitCode===null)server.kill('SIGTERM');}
  if(server.exitCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>{server.kill('SIGKILL');resolve();},5000);server.once('exit',()=>{clearTimeout(timer);resolve();});});
  rpc.close();await handle.close();if(success)await rm(directory,{recursive:true,force:true});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let i=2;i<process.argv.length;i++){const arg=process.argv[i];if(arg==='--references'){options.references=true;continue;}if(!['--release','--herdr','--proof'].includes(arg)||!process.argv[i+1])throw new Error('Use --release ROOT [--herdr BIN] [--proof DIR] [--references]');options[arg.slice(2)]=process.argv[++i];}
 try{console.log(JSON.stringify(await liveFeaturesTest(options),null,2));}catch(error){console.error(error.stack??String(error));process.exitCode=1;}
}
