import type {HerdrAgent,Rpc} from '../model/types.ts';
import {ProcessTracker} from '../process/ownership.ts';
import type {ProcessView} from '../process/ownership.ts';
import {SidebarSampler} from '../process/sidebar-sampler.ts';
import type {GitCache,GitSummary} from '../git/cache.ts';
export interface SidebarProcessSampler {sample(pids:number[]):ReturnType<SidebarSampler['sample']>;close():Promise<void>;}
const owner=(agent:HerdrAgent)=>JSON.stringify([agent.terminal_id,agent.agent,agent.agent_session?.kind,agent.agent_session?.value]);
const occupant=(a:HerdrAgent,b:HerdrAgent)=>a.terminal_id===b.terminal_id&&a.agent===b.agent&&a.agent_session?.kind===b.agent_session?.kind&&a.agent_session?.value===b.agent_session?.value;
/** Inventory for native cards only. Never supplies inspector ownership or termination proofs. */
export class SidebarInventory {
 private tracker=new ProcessTracker();private resources=new Map<string,{agent:HerdrAgent;view:ProcessView}>();private identities=new Map<string,GitSummary>();private lastAttempt=-Infinity;private stopped=false;
 private rpc:Rpc;private git:GitCache;private harness:(provider:string,p:any)=>boolean;private sampler:SidebarProcessSampler;private sampleResources:boolean;
 constructor(rpc:Rpc,git:GitCache,harness:(provider:string,p:any)=>boolean,sampler:SidebarProcessSampler=new SidebarSampler(),sampleResources=true){this.rpc=rpc;this.git=git;this.harness=harness;this.sampler=sampler;this.sampleResources=sampleResources;}
 private async root(agent:HerdrAgent):Promise<number|undefined>{
  if(this.stopped)return;
  const result=await this.rpc.call('agent.get',{target:agent.pane_id}),live=result.agent??result;
  if(this.stopped||!occupant(agent,live))return;
  const reply=await this.rpc.call('pane.process_info',{pane_id:agent.pane_id}),info=reply.process_info??reply;
  const candidates=(info.foreground_processes??[]).filter((p:any)=>Number.isSafeInteger(p.pid)&&p.pid>0&&this.harness(agent.agent??'unknown',p));
  const leader=candidates.find((p:any)=>p.pid===info.foreground_process_group_id);
  // Ambiguous groups cannot establish the harness root safely.
  return leader?.pid??(candidates.length===1?candidates[0].pid:undefined);
 }
 async update(agents:HerdrAgent[],now=Date.now()):Promise<void>{
  const live=new Set(agents.map(a=>a.terminal_id));for(const key of this.resources.keys())if(!live.has(key))this.resources.delete(key);for(const key of this.identities.keys())if(!live.has(key))this.identities.delete(key);
  for(const agent of agents){const old=this.resources.get(agent.terminal_id);if(old&&!occupant(agent,old.agent))this.resources.delete(agent.terminal_id);}
  // A bounded worker pool shares GitCache's independently bounded child queue.
  const targets=agents.slice(0,128);let next=0;
  await Promise.all(Array.from({length:Math.min(4,targets.length)},async()=>{while(next<targets.length&&!this.stopped){const agent=targets[next++],cwd=agent.foreground_cwd??agent.cwd;
   if(cwd&&typeof this.git.getIdentity==='function'){const identity=await this.git.getIdentity(cwd);if(!this.stopped)this.identities.set(agent.terminal_id,identity);}else this.identities.delete(agent.terminal_id);
  }}));
  if(this.stopped||!this.sampleResources||now-this.lastAttempt<5000)return;this.lastAttempt=now;
  const roots:{agent:HerdrAgent;pid:number}[]=[];next=0;
  await Promise.all(Array.from({length:Math.min(4,targets.length)},async()=>{while(next<targets.length&&!this.stopped){const agent=targets[next++];try{const pid=await this.root(agent);if(pid)roots.push({agent,pid});else this.resources.delete(agent.terminal_id);}catch{this.resources.delete(agent.terminal_id);}}}));
  if(this.stopped)return;
  try{
   const batch=await this.sampler.sample([...new Set(roots.map(r=>r.pid))].sort((a,b)=>a-b));
   if(this.stopped)return;
   const verified:{agent:HerdrAgent;pid:number}[]=[];next=0;
   await Promise.all(Array.from({length:Math.min(4,roots.length)},async()=>{while(next<roots.length&&!this.stopped){const root=roots[next++];try{if(await this.root(root.agent)===root.pid)verified.push(root);else this.resources.delete(root.agent.terminal_id);}catch{this.resources.delete(root.agent.terminal_id);}}}));
   if(this.stopped)return;
   const pids=new Set(verified.map(r=>r.pid));batch.processes=batch.processes.filter(p=>pids.has(p.pid));
   this.tracker.update(batch,verified.map(r=>({sessionKey:owner(r.agent),pid:r.pid,startTime:batch.processes.find(p=>p.pid===r.pid)?.startTime})));
   for(const root of verified)this.resources.set(root.agent.terminal_id,{agent:structuredClone(root.agent),view:this.tracker.view(owner(root.agent))});
  }catch(error){for(const root of roots){const previous=this.resources.get(root.agent.terminal_id);if(previous)previous.view={...previous.view,availability:'stale',reason:(error as Error).message};}}
 }
 resource(agent:HerdrAgent,now=Date.now()):ProcessView|undefined{const record=this.resources.get(agent.terminal_id);if(!record||!occupant(agent,record.agent))return;return now-(record.view.sampledAt??0)>15000?{...record.view,availability:'stale',reason:'Harness sample expired'}:record.view;}
 gitIdentity(agent:HerdrAgent,detail?:GitSummary):GitSummary|undefined{
  const identity=this.identities.get(agent.terminal_id);
  if(!identity)return detail;
  // Cached counts can survive only while the exact checkout and HEAD still match.
  if(identity.availability==='known'&&detail&&detail.checkoutKey===identity.checkoutKey&&detail.branch===identity.branch&&detail.head===identity.head&&detail.branchState===identity.branchState&&!detail.identityOnly)
   return {...detail,...identity,identityOnly:false,added:detail.added,deleted:detail.deleted,conflicts:detail.conflicts,ahead:detail.ahead,behind:detail.behind,availability:'stale',sampledAt:detail.sampledAt,ageMs:Math.max(0,Date.now()-detail.sampledAt),reason:'Branch identity is live; change counts are cached from inspector'};
  return identity;
 }
 async close(){this.stopped=true;await this.sampler.close();this.resources.clear();this.identities.clear();}
}
