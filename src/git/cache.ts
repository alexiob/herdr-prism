import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseNumstat, parseStatus } from './status.ts';
export interface GitSummary { availability:'known'|'stale'|'unavailable'|'not_applicable';reason?:string;sampledAt:number;ageMs:number;cwd:string;root?:string;gitDir?:string;commonDir?:string;checkoutKey?:string;familyKey?:string;branch?:string;head?:string;branchState:'named'|'detached'|'unborn'|'non-git'|'unknown';added?:number;deleted?:number;binaryFiles?:number;changedFiles?:number;untrackedFiles?:number;conflicts?:number;stagedFiles?:number;unstagedFiles?:number;ahead?:number;behind?:number;upstream?:string; }
export type GitRunner=(cwd:string,args:string[],options:{timeoutMs:number;signal:AbortSignal})=>Promise<string>;
interface Identity {root:string;gitDir:string;commonDir:string;checkoutKey:string;familyKey:string;}
// One host queue for all cache instances, with at most two Git processes.
let active=0;const waiting:Array<()=>void>=[];
async function queued<T>(job:()=>Promise<T>):Promise<T>{if(active>=2)await new Promise<void>(done=>waiting.push(done));else active++;try{return await job();}finally{const next=waiting.shift();if(next)next();else active--;}}
const defaultRunner:GitRunner=(cwd,args,options)=>new Promise((yes,no)=>{const env={...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_PAGER:'cat',GIT_EXTERNAL_DIFF:'',GIT_CONFIG_COUNT:'0'};for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES','GIT_CEILING_DIRECTORIES','GIT_DISCOVERY_ACROSS_FILESYSTEM'])delete (env as NodeJS.ProcessEnv)[key];execFile('git',['--no-optional-locks','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','core.quotePath=false',...args],{cwd,encoding:'utf8',timeout:options.timeoutMs,maxBuffer:8*1024*1024,signal:options.signal,windowsHide:true,env},(error,out,stderr)=>{if(error)no(Object.assign(error,{stderr}));else yes(out);});});
function line(text:string){return text.endsWith('\n')?text.slice(0,-1):text;}
export class GitCache {
 private aliases=new Map<string,Identity>();
 private samples=new Map<string,GitSummary>();
 private pending=new Map<string,Promise<GitSummary>>();
 private refreshing=new Map<string,Promise<GitSummary>>();
 private invalidated=new Set<string>();
 private controllers=new Set<AbortController>();
 private closed=false;
 private ttl:number;private timeout:number;private max:number;private runner:GitRunner;private now:()=>number;
 constructor(options:{ttlMs?:number;timeoutMs?:number;maxEntries?:number;runner?:GitRunner;now?:()=>number}={}){this.ttl=options.ttlMs??5000;this.timeout=options.timeoutMs??2500;this.max=options.maxEntries??128;this.runner=options.runner??defaultRunner;this.now=options.now??Date.now;if(!Number.isInteger(this.max)||this.max<1||this.max>4096)throw new Error('Invalid maxEntries');if(!Number.isFinite(this.timeout)||this.timeout<=0||this.timeout>60000)throw new Error('Invalid timeoutMs');if(!Number.isFinite(this.ttl)||this.ttl<0)throw new Error('Invalid ttlMs');}
 private async run(cwd:string,args:string[]){
  if(this.closed)throw new Error('Git cache closed');const controller=new AbortController();this.controllers.add(controller);
  try{return await queued(()=>{if(this.closed)throw new Error('Git cache closed');return this.runner(cwd,args,{timeoutMs:this.timeout,signal:controller.signal});});}
  finally{this.controllers.delete(controller);}
 }
 private async identity(cwd:string):Promise<Identity>{
  const root=await realpath(line(await this.run(cwd,['rev-parse','--show-toplevel'])));
  const gitDir=await realpath(line(await this.run(root,['rev-parse','--absolute-git-dir'])));
  const commonDir=await realpath(line(await this.run(root,['rev-parse','--path-format=absolute','--git-common-dir'])));
  return {root,gitDir,commonDir,checkoutKey:JSON.stringify([root,gitDir]),familyKey:commonDir};
 }
 private fresh(identity:Identity,ttlMs=this.ttl){const prior=this.samples.get(identity.checkoutKey);return prior&&!this.invalidated.has(identity.checkoutKey)&&this.now()-prior.sampledAt<ttlMs?{...prior,ageMs:Math.max(0,this.now()-prior.sampledAt)}:undefined;}
 private refresh(identity:Identity):Promise<GitSummary>{
  const pending=this.refreshing.get(identity.checkoutKey);if(pending)return pending;
  const job=(async():Promise<GitSummary>=>{
   const status=parseStatus(await this.run(identity.root,['status','--porcelain=v2','-z','--branch','--untracked-files=all']));
   const counts=status.branchState==='unborn'?{}:parseNumstat(await this.run(identity.root,['diff','--no-ext-diff','--no-textconv','--numstat','-z','HEAD','--']));
   const sample:GitSummary={availability:'known',sampledAt:this.now(),ageMs:0,cwd:identity.root,...identity,...status,...counts};
   this.samples.delete(identity.checkoutKey);this.samples.set(identity.checkoutKey,sample);this.invalidated.delete(identity.checkoutKey);
   while(this.samples.size>this.max){const oldest=this.samples.keys().next().value!;this.samples.delete(oldest);this.invalidated.delete(oldest);for(const [alias,item]of this.aliases)if(item.checkoutKey===oldest)this.aliases.delete(alias);}
   return sample;
  })();this.refreshing.set(identity.checkoutKey,job);void job.finally(()=>this.refreshing.delete(identity.checkoutKey)).catch(()=>{});return job;
 }
 async get(cwd:string,options:{ttlMs?:number}={}):Promise<GitSummary>{
  const ttlMs=options.ttlMs??this.ttl;if(!Number.isFinite(ttlMs)||ttlMs<0)throw new Error('Invalid ttlMs');
  const input=resolve(cwd);const running=this.pending.get(input);if(running)return running;
  let identity=this.aliases.get(input);const cached=identity?this.fresh(identity,ttlMs):undefined;if(cached)return cached;
  const job=(async():Promise<GitSummary>=>{try{
   if(!identity||this.invalidated.has(identity.checkoutKey))identity=await this.identity(input);this.aliases.set(input,identity);this.aliases.set(identity.root,identity);while(this.aliases.size>this.max*8)this.aliases.delete(this.aliases.keys().next().value!);
   return this.fresh(identity,ttlMs)??await this.refresh(identity);
  }catch(error){
   const err=error as Error&{stderr?:string;code?:string;killed?:boolean};
   const reason=err.code==='ETIMEDOUT'||err.killed?'Git timed out':err.code==='EACCES'||err.code==='EPERM'?'Git access denied':err.message;
   const prior=identity?this.samples.get(identity.checkoutKey):undefined;
   if(prior)return {...prior,availability:'stale',ageMs:Math.max(0,this.now()-prior.sampledAt),reason};
   const nonGit=!!err.stderr?.includes('not a git repository');
   return {availability:nonGit?'not_applicable':'unavailable',branchState:nonGit?'non-git':'unknown',reason,sampledAt:this.now(),ageMs:0,cwd:input};
  }})();this.pending.set(input,job);try{return await job;}finally{this.pending.delete(input);}
 }
 invalidate(cwd?:string){if(cwd===undefined){for(const key of this.samples.keys())this.invalidated.add(key);return;}const path=resolve(cwd);const identity=this.aliases.get(path);if(identity)this.invalidated.add(identity.checkoutKey);}
 close(){this.closed=true;for(const controller of this.controllers)controller.abort();this.controllers.clear();this.aliases.clear();this.samples.clear();this.invalidated.clear();}
}
