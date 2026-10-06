import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {execFile} from 'node:child_process';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
const options=JSON.parse(await readFile(process.argv[2],'utf8'));
const baselineRss=process.memoryUsage().rss;
const status=createWriteStream(null,{fd:Number(process.argv[4]),autoClose:false});
const report=value=>status.write(JSON.stringify(value)+'\n');
let collector,ui,closing=false,frame,gitCpuUs=0,gitCalls=0,gitPeakBytes=0,peakRss=baselineRss,helperPeakBytes=0,lastHelper,workerReport,memoryTimer,control,initializationMs;
const expected=new Set(options.sessions.flatMap(s=>[s.pid,...s.children]));
const started=process.hrtime.bigint();
try {
 const [{Collector},{GitCache},{createSampler},{TerminalUi},{createUiState,renderScreen,handleKey}]=await Promise.all([
  import('../../dist/runtime/collector.js'),import('../../dist/git/cache.js'),import('../../dist/process/sampler.js'),import('../../dist/tui/terminal.js'),import('../../dist/tui/screen.js')]);
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('Actual PTY required');
 const gitRunner=(cwd,args,{timeoutMs,signal})=>new Promise((yes,no)=>{
  const env={...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_PAGER:'cat',GIT_EXTERNAL_DIFF:'',GIT_CONFIG_COUNT:'0'};
  for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES','GIT_CEILING_DIRECTORIES','GIT_DISCOVERY_ACROSS_FILESYSTEM'])delete env[key];
  execFile(options.executable,['--exec','git','--no-optional-locks','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','core.quotePath=false',...args],{cwd,env,encoding:'utf8',timeout:timeoutMs,signal,maxBuffer:8*1024*1024},(error,out,stderr)=>{
   const match=/HAT_PROFILE_RUSAGE (\{[^\n]+\})/.exec(stderr);if(match){const usage=JSON.parse(match[1]);gitCpuUs+=usage.cpuUs;gitCalls++;gitPeakBytes=Math.max(gitPeakBytes,usage.maxRssBytes);}else {no(new Error('Git child CPU accounting missing'));return;}
   if(error)no(error);else yes(out);
  });
 });
 const agents=options.sessions.map((s,i)=>({pane_id:`profile:${i}`,terminal_id:`terminal:${i}`,workspace_id:'profile',tab_id:'profile',agent:'pi',agent_status:'idle',name:`Profile ${i}`,focused:i===0,revision:1,agent_session:{source:'herdr:pi',agent:'pi',kind:'path',value:s.path}}));
 const counts={snapshot:0,agentGet:0,processInfo:0};
 const rpc={async call(method,payload){if(method==='session.snapshot'){counts.snapshot++;return {snapshot:{protocol:22,version:'controlled-profile',agents,panes:[],tabs:[],workspaces:[],layouts:[]}};}const index=Number(String(payload?.target??payload?.pane_id).split(':').at(-1));if(method==='agent.get'){counts.agentGet++;return {agent:agents[index]};}if(method==='pane.process_info'){counts.processInfo++;return {process_info:{foreground_processes:[{pid:options.sessions[index].pid,name:'pi',argv:[options.executable]}]}};}if(method==='agent.view.clear')return {};throw new Error('Unexpected controlled RPC method');}};
 const actual=createSampler({helperPath:options.helper});
 const sampler={async sample(){const batch=await actual.sample();const helpers=batch.processes.filter(p=>p.ppid===process.pid&&/hat-sampler/.test(p.name));if(process.platform==='darwin'&&(helpers.length!==1||helpers[0].availability!=='known'))throw new Error('Cannot identify exactly one readable owned native helper');lastHelper=helpers[0];if(lastHelper)helperPeakBytes=Math.max(helperPeakBytes,Number(lastHelper.rssBytes));const present=new Set(batch.processes.map(p=>p.pid));if([...expected].some(pid=>!present.has(pid)))throw new Error('Controlled process census incomplete');return batch;},close:()=>actual.close()};
 collector=new Collector({rpc,sampler,git:new GitCache({runner:gitRunner}),stateDir:options.stateDir,paneOpen:true,visibleSession:'pi:profile-0',settings:{nativeMode:'inspector-only',providerHomes:options.homes,todosEnabled:false,sampleIntervalMs:2000,follow:false,ascii:true,monochrome:true}});
 ui=new TerminalUi({monochrome:true});const state=createUiState();state.ascii=true;state.monochrome=true;state.selectedKey='pi:profile-0';
 const paint=()=>{collector.setProcessesExpanded(state.tab==='Processes');frame=renderScreen(collector.data,state,ui.columns,ui.rows);ui.paint(frame);};
 collector.on('data',paint);ui.on('resize',paint);ui.on('input',event=>{if(event.type!=='key')return;const action=handleKey(state,event.key,collector.data,frame);if(action?.type==='quit'){closing=true;report({quit:true});}paint();});
 await collector.start();await collector.sampleProcesses();
 const initial=collector.data.sessions.find(s=>s.key==='pi:profile-0');
 if(collector.data.sessions.length!==options.sessions.length||collector.data.stale||initial?.resource?.coverage.readable!==options.sessions[0].children.length+1)throw new Error(`Selected collector census or readable resources failed: sessions=${collector.data.sessions.length}, stale=${collector.data.stale}, readable=${initial?.resource?.coverage.readable??'unknown'}; ${(initial?.resource?.reason??collector.data.diagnostics.at(-1)??'no diagnostic').slice(0,300)}`);
 const union=collector.tracker.view('pi:profile-0',true,options.sessions.slice(1).map((_,i)=>`pi:profile-${i+1}`));
 if(union.processes.length!==expected.size||union.processes.some(p=>!expected.has(p.pid)))throw new Error('Controlled process ownership census did not match');
 if(collector.data.sessions.slice(1).some(s=>s.resource?.availability==='known'||s.evidence.messages.length))throw new Error('Invisible sessions loaded body/resource details');
 ui.start();paint();initializationMs=Number(process.hrtime.bigint()-started)/1e6;
 memoryTimer=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},100);
 control=createInterface({input:createReadStream(null,{fd:Number(process.argv[3]),autoClose:false})});let eventCommands=0,resolveDrain;
 const drained=new Promise(resolve=>{resolveDrain=resolve;});
 control.on('line',line=>{try{const command=JSON.parse(line);if(command.type==='drained')resolveDrain();else if(command.type==='event'){agents[0].name=command.marker;agents[0].agent_status='working';eventCommands++;void appendFile(options.sessions[0].path,JSON.stringify({type:'message',id:`profile-new-${eventCommands}`,timestamp:new Date().toISOString(),message:{role:'assistant',content:'Controlled profile update',usage:{input:10,output:2,totalTokens:12}}})+'\n').then(()=>collector.invalidate());}}catch{closing=true;}});
 const phases=[];
 for(const name of ['idle','active']){
  await collector.refresh();await collector.sampleProcesses();
  const nodeStart=process.cpuUsage(),gitStart=gitCpuUs,helperStart=lastHelper?{pid:lastHelper.pid,startTime:lastHelper.startTime,cpuNs:lastHelper.cpuNs}:undefined,at=process.hrtime.bigint();
  report({phase:name,seconds:options.seconds});
  await delay(options.seconds*1000);
  if(name==='active'){
   report({measurementComplete:true});
   let timer;try{await Promise.race([drained,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Outstanding terminal acknowledgements did not drain')),3000);})]);}finally{clearTimeout(timer);}
  }
  await collector.refresh();await collector.sampleProcesses();
  const wallNs=process.hrtime.bigint()-at,node=process.cpuUsage(nodeStart);let helperNs=0n;
  if(helperStart){if(lastHelper?.pid!==helperStart.pid||lastHelper?.startTime!==helperStart.startTime)throw new Error('Helper identity changed during profile phase');helperNs=BigInt(lastHelper.cpuNs)-BigInt(helperStart.cpuNs);if(helperNs<0n)throw new Error('Helper CPU counter reset during profile phase');}
  const nodeNs=BigInt(node.user+node.system)*1000n,gitNs=BigInt(Math.round(gitCpuUs-gitStart))*1000n;
  phases.push({name,wallMs:Number(wallNs)/1e6,nodeCpuPercent:Number(nodeNs)*100/Number(wallNs),helperCpuPercent:Number(helperNs)*100/Number(wallNs),gitCpuPercent:Number(gitNs)*100/Number(wallNs),aggregateCpuPercent:Number(nodeNs+helperNs+gitNs)*100/Number(wallNs)});
 }
 clearInterval(memoryTimer);control.close();
 workerReport={ok:true,phases,declaredSessions:options.sessions.length,actualControlledProcesses:expected.size,trackedControlledProcesses:union.processes.length,selectedProcesses:initial.resource.processes.length,historyBytes:options.historyBytes,baselineRssBytes:baselineRss,peakNodeRssBytes:peakRss,incrementalNodeRssBytes:Math.max(0,peakRss-baselineRss),gitPeakChildRssBytes:gitPeakBytes,incrementalMemoryUpperBoundBytes:Math.max(0,peakRss-baselineRss)+gitPeakBytes*2,helperPeakRssBytes:helperPeakBytes,gitCalls,eventCommands,rpcCalls:counts,visibleOnly:true,initializationMs};
 await collector.close({clearNative:false});collector=undefined;
 await writeFile(options.workerReport,JSON.stringify(workerReport,null,2)+'\n');
 report({finished:true});
}catch(error){report({error:String(error?.message??error)});process.exitCode=1;}
finally{clearInterval(memoryTimer);control?.close();await collector?.close({clearNative:false});ui?.close();status.end();}
