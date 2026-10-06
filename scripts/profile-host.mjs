#!/usr/bin/env node
// Opt-in development measurement. Every written file and controlled process is disposable.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,appendFile,rm,stat} from 'node:fs/promises';
import {tmpdir,availableParallelism} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {verifyHelper} from './check-install.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),run=promisify(execFile);
const support=join(root,'scripts/profile-host');
const args=process.argv.slice(2),options={seconds:20,output:join(root,'artifacts','host-profile')};
let enabled=false,selfCheck=false;
for(let i=0;i<args.length;i++){
 const arg=args[i];if(arg==='--run'){enabled=true;continue;}if(arg==='--self-check'){enabled=true;selfCheck=true;continue;}if(arg==='--cpu-prof'){options.cpuProf=true;continue;}
 if(!['--seconds','--output','--helper'].includes(arg)||!args[i+1])throw new Error('Usage: node scripts/profile-host.mjs --run [--seconds 10..60] [--output DIR] [--helper PATH]; --self-check runs a reduced fixture');
 options[arg.slice(2)]=args[++i];
}
if(!enabled)throw new Error('Opt-in required: --run creates 500 disposable OS processes and 100 MiB of fixture history; coordinate other load first');
if(!['darwin','linux'].includes(process.platform))throw new Error('Actual-host profiler requires Unix PTY; Windows ConPTY performance remains an explicit pending gate');
options.seconds=Number(options.seconds);if(!Number.isInteger(options.seconds)||options.seconds<10||options.seconds>60)throw new Error('seconds must be an integer from 10 through 60');
if(selfCheck)options.seconds=2;
options.output=resolve(options.output);
const sessionCount=selfCheck?2:50,totalProcesses=selfCheck?6:500,historyBytes=(selfCheck?1:100)*1024*1024;
if(options.helper)options.helper=resolve(options.helper);
else if(process.platform==='darwin')options.helper=(await verifyHelper(root,'darwin',process.arch,{artifactDir:'native/sampler/artifacts'})).path;
await stat(join(root,'dist/runtime/collector.js'));
const directory=await mkdtemp(join(tmpdir(),'hat-host-profile-')),workers=[];
let stopped=false,profilingChild;
const alive=child=>Number.isInteger(child.pid)&&child.exitCode===null&&child.signalCode===null;
const cleanup=async()=>{if(stopped)return;stopped=true;for(const item of workers)item.child.stdin.end();await Promise.all(workers.map(async item=>{if(!alive(item.child))return;const done=once(item.child,'exit');await Promise.race([done,delay(3000,undefined,{ref:false}).then(()=>{if(alive(item.child))item.child.kill('SIGTERM');})]);if(alive(item.child)){item.child.kill('SIGKILL');await done;}}));await rm(directory,{recursive:true,force:true});};
const cancel=()=>{void(async()=>{if(profilingChild&&alive(profilingChild)){const done=once(profilingChild,'exit');profilingChild.kill('SIGTERM');await Promise.race([done,delay(10000,undefined,{ref:false}).then(()=>{if(alive(profilingChild))profilingChild.kill('SIGKILL');})]);}await cleanup();process.exit(130);})();};process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
try {
 await mkdir(options.output,{recursive:true});
 const executable=join(directory,'pi');
 await run('cc',['-O2',join(support,'processes.c'),'-o',executable],{timeout:30000,maxBuffer:1024*1024});
 const accounting=await run(executable,['--exec',executable,'--cpu','100'],{timeout:5000});
 const usage=JSON.parse(/HAT_PROFILE_RUSAGE (\{[^\n]+\})/.exec(accounting.stderr)?.[1]??'null');
 if(!usage||usage.cpuUs<90000)throw new Error('OS child CPU accounting self-check failed');
 const checkout=join(directory,'checkout');await mkdir(checkout);
 const fixtureGitEnv={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_COUNT:'0',GIT_TERMINAL_PROMPT:'0'};
 for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES','GIT_CEILING_DIRECTORIES','GIT_DISCOVERY_ACROSS_FILESYSTEM'])delete fixtureGitEnv[key];
 const setupGit=args=>run('git',args,{env:fixtureGitEnv,timeout:10000,maxBuffer:1024*1024});
 await setupGit(['init','--quiet','--initial-branch=profile',checkout]);await writeFile(join(checkout,'tracked.txt'),'Controlled fixture\n');await setupGit(['-C',checkout,'add','tracked.txt']);
 await setupGit(['-C',checkout,'-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','-c','user.name=Herdr Prism Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Disposable profile fixture']);await appendFile(join(checkout,'tracked.txt'),'Measured dirty checkout\n');
 const homes={pi:join(directory,'pi-home'),codex:join(directory,'empty-codex'),claude:join(directory,'empty-claude')};await mkdir(join(homes.pi,'sessions'),{recursive:true});
 const sessions=[];let actualHistoryBytes=0;
 for(let i=0;i<sessionCount;i++){
  const path=join(homes.pi,'sessions',`profile-${i}.jsonl`),target=Math.ceil(historyBytes/sessionCount);
  await writeFile(path,JSON.stringify({type:'session',version:3,id:`profile-${i}`,cwd:checkout,timestamp:'2026-10-06T00:00:00Z'})+'\n');
  let bytes=(await stat(path)).size,ordinal=0;
  while(bytes<target){const rows=[];for(let j=0;j<32&&bytes<target;j++){const row=JSON.stringify({type:'message',id:`m-${ordinal++}`,timestamp:'2026-10-06T00:00:01Z',message:{role:ordinal%2?'user':'assistant',content:'Controlled transcript fixture '+'.'.repeat(3900)}})+'\n';bytes+=Buffer.byteLength(row);rows.push(row);}await appendFile(path,rows.join(''));}
  actualHistoryBytes+=bytes;
  const child=spawn(executable,[String(totalProcesses/sessionCount-1)],{cwd:checkout,stdio:['pipe','pipe','pipe']});const item={child,children:[]};workers.push(item);child.stderr.resume();child.stdin.on('error',()=>{});const reader=createInterface({input:child.stdout});let timeout;
  try{const [line]=await Promise.race([once(reader,'line'),once(child,'error').then(([error])=>{throw error;}),once(child,'exit').then(()=>{throw new Error('Controlled harness exited during ramp');}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Controlled process ramp failed')),5000);})]);const announced=JSON.parse(line);if(announced.pid!==child.pid||announced.children.length!==totalProcesses/sessionCount-1)throw new Error('Controlled process count mismatch');item.children=announced.children;sessions.push({pid:child.pid,children:announced.children,path});}finally{clearTimeout(timeout);reader.close();}
  if((i+1)%10===0)console.log(`Controlled ramp: ${i+1} sessions, ${(i+1)*totalProcesses/sessionCount} processes`);
 }
 const config={...options,executable,sessions,homes,stateDir:join(directory,'state'),historyBytes:actualHistoryBytes,workerReport:join(options.output,'worker.json')};const configPath=join(directory,'options.json');await writeFile(configPath,JSON.stringify(config));
 console.log(`Profile: ${sessionCount} declared sessions, ${totalProcesses} real processes, ${(actualHistoryBytes/1048576).toFixed(1)} MiB history; ${options.seconds}s idle + ${options.seconds}s active`);
 const profile=run('python3',['-B',join(support,'unix_pty.py'),process.execPath,join(support,'worker.mjs'),configPath,join(options.output,'terminal.json')],{timeout:options.seconds*2000+45000,maxBuffer:1024*1024});profilingChild=profile.child;await profile;profilingChild=undefined;
 const measured=JSON.parse(await readFile(config.workerReport,'utf8')),terminal=JSON.parse(await readFile(join(options.output,'terminal.json'),'utf8'));
 await cleanup();
 const ownedPids=sessions.flatMap(s=>[s.pid,...s.children]);const leftovers=ownedPids.filter(pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}});
 if(leftovers.length)throw new Error('Controlled process teardown failed');
 const budget={idleCpuBelow1:measured.phases.find(p=>p.name==='idle').aggregateCpuPercent<1,activeCpuBelow3:measured.phases.find(p=>p.name==='active').aggregateCpuPercent<3,incrementalMemoryBelow150MiB:measured.incrementalMemoryUpperBoundBytes<150*1048576,eventP95Below500Ms:terminal.eventP95Ms<500,keyboardP95Below100Ms:terminal.keyboardP95Ms<100};
 const report={at:new Date().toISOString(),platform:process.platform,arch:process.arch,node:process.version,logicalCores:availableParallelism(),fixtureScale:selfCheck?'reduced self-check':'design scale',cpuProfilerEnabled:options.cpuProf===true,measurementScope:'actual Collector/ProviderIndex/native helper/Git subprocesses/renderScreen/TerminalUi with controlled RPC and actual Unix PTY; full Herdr transport not measured',activeWorkload:'2 snapshot events and selected transcript appends per second, keyboard tab cycle about 3 per second; selected-only body/Git/resource views; documented sampler cadence: 2s default, 1s expanded Processes, 5s inactive selection; selected Git 5s working, 30s idle',measured,terminal,budget,cleanup:{ownedPids:ownedPids.length,survivors:0,temporaryDirectoryRemoved:true},certifiesFullHerdrPerformance:false};
 await writeFile(join(options.output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output:options.output,budget,phases:measured.phases,eventP95Ms:terminal.eventP95Ms,keyboardP95Ms:terminal.keyboardP95Ms,incrementalMemoryMiB:measured.incrementalMemoryUpperBoundBytes/1048576,certifiesFullHerdrPerformance:false},null,2));
 if(!selfCheck&&Object.values(budget).some(value=>!value))process.exitCode=1;
}finally{await cleanup();process.off('SIGINT',cancel);process.off('SIGTERM',cancel);}
