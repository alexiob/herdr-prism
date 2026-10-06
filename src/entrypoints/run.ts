import {spawn,type StdioOptions} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {constants} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parseArguments,runtimeContext} from '../runtime/actions.ts';
import {existingController} from '../runtime/service.ts';
import {StateStore} from '../state/store.ts';
import {createSampler,type ProcessSampler} from '../process/sampler.ts';
export interface LaunchController {request(op:string,payload?:any):Promise<unknown>;}
export interface LaunchDependencies {controller?:LaunchController;sampler?:ProcessSampler;stdio?:StdioOptions;diagnostic?:(message:string)=>void;signals?:{on(name:string,handler:()=>void):unknown;off(name:string,handler:()=>void):unknown};}
export interface LaunchResult {exitCode:number;signal?:NodeJS.Signals;registered:boolean;unmeasured:boolean;}
/** Foreground explicit argv wrapper. It can attribute only the direct identity it actually sampled. */
export async function run(argv:string[],dependencies:LaunchDependencies={}):Promise<LaunchResult>{
 const separator=argv.indexOf('--');if(separator<0||separator===argv.length-1)throw new Error('run requires --agent PROVIDER:ID -- executable [argv...]');
 const parsed=parseArguments(['run',...argv.slice(0,separator)]);const agent=parsed.options.agent;
 if(typeof agent!=='string'||agent.indexOf(':')<1||agent.endsWith(':')||agent.length>8192||agent.includes('\0'))throw new Error('run requires a valid --agent PROVIDER:ID');
 for(const key of Object.keys(parsed.options))if(!['agent','config-dir','state-dir','config-path','socket'].includes(key))throw new Error(`Unsupported run option --${key}`);
 if(parsed.positionals.length)throw new Error('Command arguments must follow --');
 const command=argv.slice(separator+1);if(command.some(value=>value.includes('\0')))throw new Error('Command arguments cannot contain NUL');
 const diagnostic=dependencies.diagnostic??((message:string)=>console.error(`agent-tree run: ${message}`));let controller:LaunchController|undefined=dependencies.controller;
 let context:ReturnType<typeof runtimeContext>|undefined;let marker:{token:string;pid:number}|undefined;
 if(!Object.hasOwn(dependencies,'controller')){try{context=runtimeContext(parsed.options);const existing=await existingController(context);controller=existing?.client;marker=existing?.marker;}catch(error){diagnostic(`untracked launch: collector context unavailable (${(error as Error).message})`);}}
 const sampler=dependencies.sampler??createSampler();const child=spawn(command[0]!,command.slice(1),{shell:false,stdio:dependencies.stdio??'inherit',detached:false});
 let samplerClosed=false;const closeSampler=async()=>{if(samplerClosed)return;samplerClosed=true;await sampler.close().catch(error=>diagnostic(`sampler close failed: ${(error as Error).message}`));};
 let ended=false;let registered=false;let id:string|undefined;
 const done=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>{child.once('exit',(code,signal)=>{ended=true;resolve({code,signal});});child.once('error',(error:NodeJS.ErrnoException)=>{ended=true;diagnostic(`command failed: ${error.message}`);resolve({code:error.code==='EACCES'?126:127,signal:null});});});
 const signals=dependencies.signals??process;
 const interrupt=()=>{if(!ended)child.kill('SIGINT');};const terminate=()=>{if(!ended)child.kill('SIGTERM');};
 signals.on('SIGINT',interrupt);signals.on('SIGTERM',terminate);
 try{
  if(!controller)diagnostic('untracked launch: no authenticated foreground collector is available');
  else if(child.pid){try{let sample;for(let attempts=0;attempts<3&&!ended;attempts++){const batch=await sampler.sample();sample=batch.processes.find(p=>p.pid===child.pid&&p.availability!=='unavailable');if(sample){if(!/^\d{1,40}$/.test(sample.startTime)||!batch.bootId)throw new Error('Sampler returned an invalid launch identity');id=randomUUID();await controller.request('launch',{id,sessionKey:agent,pid:child.pid,startTime:sample.startTime,bootId:batch.bootId});registered=true;break;}if(!ended)await new Promise(resolve=>setTimeout(resolve,50));}
   if(!registered)diagnostic('unmeasured launch: command ended before a readable process identity was captured');
  }catch(error){diagnostic(`untracked launch: identity/registration unavailable (${(error as Error).message})`);}}
  await closeSampler();
  const exit=await done;
  if(registered&&id){try{let current=true;if(context&&marker){const original=await new StateStore(context.serverStateDir).read<{token:string;pid:number}>('controller');const lifecycle=await new StateStore(context.stateDir).read<{disabled?:boolean}>('lifecycle');current=original?.token===marker.token&&original?.pid===marker.pid&&lifecycle?.disabled!==true;}if(current){const ping=await controller!.request('ping') as {alive?:boolean}|undefined;if(ping?.alive===true)await controller!.request('exit-launch',{id});}}catch(error){diagnostic(`launch exit not recorded: ${(error as Error).message}`);}}
  return {exitCode:exit.code??128+(constants.signals[exit.signal!]??1),signal:exit.signal??undefined,registered,unmeasured:!registered};
 }finally{signals.off('SIGINT',interrupt);signals.off('SIGTERM',terminate);await closeSampler();}
}
export async function main(argv=process.argv.slice(2)){const result=await run(argv);process.exitCode=result.exitCode;return result;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(`agent-tree run: ${error.message}`);process.exitCode=2;});
