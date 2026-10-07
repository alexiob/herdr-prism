import type {Availability,ProcessSample,SampleBatch} from '../model/types.ts';
import {LaunchLedger,processKey} from './ledger.ts';
export interface ProcessRoot {sessionKey:string;pid:number;startTime?:string;}
export interface OwnedProcess extends ProcessSample {key:string;owner:string;isHarness?:boolean;cpuPercent?:number;}
export interface ProcessView {processes:OwnedProcess[];cpuPercent?:number;memoryBytes?:string;availability:Availability;coverage:{readable:number;total:number};cpuCoverage:{readable:number;total:number};memoryLabel:'RSS sum'|'working-set sum';sampledAt?:number;sharedWith?:string;reason?:string;errors:string[];unreadablePids:number[];}
interface OwnerBatch {processes:OwnedProcess[];unreadablePids:number[];total:number;readable:number;cpuReadable:number;cpu:number;memory:bigint;}
export class ProcessTracker {
 private batch?:SampleBatch; private owned=new Map<string,OwnedProcess>(); private remembered=new Map<string,string>();private boundRoots=new Map<string,string>();private shared=new Map<string,string>();private unreadable=new Map<string,{pid:number;owner:string}>();
 private byOwner=new Map<string,OwnerBatch>();private order=new Map<string,number>();
 private ledger:LaunchLedger; constructor(ledger=new LaunchLedger()){this.ledger=ledger;}
 update(batch:SampleBatch,roots:ProcessRoot[],options:{resetCpuBaseline?:boolean}={}):void {
  const previous=this.batch, old=this.owned; const byPid=new Map(batch.processes.map(p=>[p.pid,p])); const rootOwners=new Map<number,string>(); this.shared.clear();
  const liveRootIds=new Set(roots.map(r=>`${r.sessionKey}:${r.pid}`));for(const k of this.boundRoots.keys())if(!liveRootIds.has(k))this.boundRoots.delete(k);
  for(const r of roots){const p=byPid.get(r.pid);if(!p)continue; const k=processKey(batch.bootId,p.pid,p.startTime), rk=`${r.sessionKey}:${r.pid}`;const bound=this.boundRoots.get(rk);
   if(r.startTime!==undefined&&r.startTime!==p.startTime)continue;if(bound&&bound!==k&&r.startTime===undefined)continue;this.boundRoots.set(rk,k);
   const other=rootOwners.get(r.pid);if(other&&other!==r.sessionKey)this.shared.set(r.sessionKey,other);else rootOwners.set(r.pid,r.sessionKey);
  }
  const next=new Map<string,OwnedProcess>();const sameBoot=previous?.bootId===batch.bootId;
  const sameClock=sameBoot&&previous?.clockEpoch===batch.clockEpoch;
  const wall=!options.resetCpuBaseline&&sameClock?BigInt(batch.monotonicNs)-BigInt(previous!.monotonicNs):0n;
  const births=new Map(batch.processes.map(p=>[p.pid,BigInt(p.startTime)]));
  const launches=new Map<number,string>();
  // Match current identities once. Restored or expired launch records never
  // become roots merely because a PID is present.
  for(const record of this.ledger.toJSON()){
   if(record.exitAt!==undefined||record.bootId!==batch.bootId||launches.has(record.pid))continue;
   if(byPid.get(record.pid)?.startTime===record.startTime)launches.set(record.pid,record.sessionKey);
  }
  const ancestry=new Map<number,string|undefined>();
  const nearestOwner=(process:ProcessSample):string|undefined=>{
   if(ancestry.has(process.pid))return ancestry.get(process.pid);
   const path:number[]=[],seen=new Set<number>();let cursor:ProcessSample|undefined=process,owner:string|undefined;
   while(cursor&&!seen.has(cursor.pid)){
    if(ancestry.has(cursor.pid)){owner=ancestry.get(cursor.pid);break;}
    seen.add(cursor.pid);path.push(cursor.pid);owner=rootOwners.get(cursor.pid)||launches.get(cursor.pid);if(owner)break;
    const parent=byPid.get(cursor.ppid??-1);
    // Birth ordering prevents a reused parent PID from capturing an older child.
    if(parent&&births.get(parent.pid)!>births.get(cursor.pid)!)break;
    cursor=parent;
   }
   for(const pid of path)ancestry.set(pid,owner);
   return owner;
  };
  for(const p of batch.processes){const k=processKey(batch.bootId,p.pid,p.startTime);let owner=nearestOwner(p);
   owner??=sameBoot?this.remembered.get(k):undefined;if(!owner)continue;
   const prior=old.get(k);let cpuPercent:number|undefined;
   if(wall>0n&&prior&&p.availability!=='unavailable'&&prior.availability!=='unavailable'){
    const delta=BigInt(p.cpuNs)-BigInt(prior.cpuNs);if(delta>=0n)cpuPercent=Number(delta)*100/Number(wall);
   }
   next.set(k,{...p,key:k,owner,isHarness:rootOwners.get(p.pid)===owner,cpuPercent});
  }
  const denied=new Set((batch.errors??[]).map(e=>/^pid (\d+)(?:[: ]).*?(?:denied|unavailable|EACCES|EPERM)/i.exec(e)?.[1]).filter(Boolean).map(Number));const unreadable=new Map<string,{pid:number;owner:string}>();if(sameBoot){for(const [key,owner]of this.remembered){const pid=Number(JSON.parse(key)[1]);if(denied.has(pid)&&!byPid.has(pid))unreadable.set(key,{pid,owner});}}for(const r of roots)if(denied.has(r.pid)&&!byPid.has(r.pid)){const key=this.boundRoots.get(`${r.sessionKey}:${r.pid}`);if(key)unreadable.set(key,{pid:r.pid,owner:r.sessionKey});}
  this.owned=next;this.unreadable=unreadable;this.remembered=new Map([...next].map(([k,p])=>[k,p.owner]));for(const [key,p]of unreadable)this.remembered.set(key,p.owner);this.batch=batch;this.ledger.reconcile(batch);
  const indices=new Map<string,OwnerBatch>();const indexFor=(owner:string)=>{let index=indices.get(owner);if(!index){index={processes:[],unreadablePids:[],total:0,readable:0,cpuReadable:0,cpu:0,memory:0n};indices.set(owner,index);}return index;};
  this.order=new Map();let ordinal=0;
  for(const process of next.values()){
   this.order.set(process.key,ordinal++);const index=indexFor(process.owner);index.processes.push(process);index.total++;
   if(process.availability!=='unavailable'){index.readable++;index.memory+=BigInt(process.rssBytes);if(process.cpuPercent!==undefined){index.cpuReadable++;index.cpu+=process.cpuPercent;}}
  }
  for(const process of unreadable.values()){const index=indexFor(process.owner);index.unreadablePids.push(process.pid);index.total++;}
  this.byOwner=indices;
 }
 view(sessionKey:string,includeDescendants=false,descendants:string[]=[]):ProcessView{
  const sessions=new Set([sessionKey,...includeDescendants?descendants:[]]);let total=0,readable=0,cpuReadable=0,cpu=0,memory=0n;
  const processes:OwnedProcess[]=[],unreadablePids:number[]=[];
  for(const owner of sessions){const index=this.byOwner.get(owner);if(!index)continue;total+=index.total;readable+=index.readable;cpuReadable+=index.cpuReadable;cpu+=index.cpu;memory+=index.memory;processes.push(...index.processes.map(process=>({...process})));unreadablePids.push(...index.unreadablePids);}
  if(sessions.size>1)processes.sort((a,b)=>this.order.get(a.key)!-this.order.get(b.key)!);
  const sharedWith=this.shared.get(sessionKey),errors=[...this.batch?.errors??[]];
  const availability:Availability=sharedWith?'not_applicable':!total?'unavailable':readable!==total||errors.length?'partial':'known';
  return {processes,cpuPercent:total&&cpuReadable===total?cpu:undefined,memoryBytes:readable?memory.toString():undefined,availability,coverage:{readable,total},cpuCoverage:{readable:cpuReadable,total},memoryLabel:this.batch?.platform==='win32'||this.batch?.platform==='windows'?'working-set sum':'RSS sum',sampledAt:this.batch?.sampledAt,sharedWith,reason:sharedWith?'shared with parent':!processes.length?'No verified live process':undefined,errors,unreadablePids};
 }
}
