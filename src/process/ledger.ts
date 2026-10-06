import type {SampleBatch} from '../model/types.ts';
export interface LaunchRecord {id:string;sessionKey:string;pid:number;startTime:string;bootId?:string;cwd?:string;exitAt?:number;}
export const processKey=(bootId:string,pid:number,startTime:string)=>JSON.stringify([bootId,pid,startTime]);
/** Only a sample from the local sampler can validate a launch; transcript facts are not accepted. */
export class LaunchLedger {
 private records=new Map<string,LaunchRecord>();
 add(record:LaunchRecord,batch:SampleBatch):LaunchRecord {
  const live=batch.processes.find(p=>p.pid===record.pid&&p.startTime===record.startTime&&p.availability!=='unavailable');
  if(!live||record.bootId!==undefined&&record.bootId!==batch.bootId)throw new Error('Launch identity is not validated by the live sample');
  const saved={...record,bootId:batch.bootId}; this.records.set(record.id,saved);return saved;
 }
 exit(id:string,at=Date.now()):void{const x=this.records.get(id);if(x)x.exitAt=at;}
 owner(batch:SampleBatch,pid:number,startTime:string):string|undefined {return [...this.records.values()].find(r=>r.exitAt===undefined&&r.bootId===batch.bootId&&r.pid===pid&&r.startTime===startTime)?.sessionKey;}
 reconcile(batch:SampleBatch):void {const keys=new Set(batch.processes.map(p=>processKey(batch.bootId,p.pid,p.startTime)));for(const [id,r]of this.records)if(!keys.has(processKey(r.bootId!,r.pid,r.startTime))&&!(r.bootId===batch.bootId&&(batch.errors??[]).some(e=>new RegExp(`^pid ${r.pid}(?:[: ]).*?(?:denied|unavailable|EACCES|EPERM)`,'i').test(e))))this.records.delete(id);}
 /** Restored private state has no ownership effect until an exact current sample matches it. */
 restore(records:unknown[]):void {this.records.clear();for(const value of records.slice(-2000)){if(!value||typeof value!=='object'||Array.isArray(value))continue;const r=value as LaunchRecord;if(typeof r.id!=='string'||!r.id||r.id.length>4096||typeof r.sessionKey!=='string'||!r.sessionKey||r.sessionKey.length>4096||!Number.isSafeInteger(r.pid)||r.pid<1||typeof r.startTime!=='string'||!/^\d{1,40}$/.test(r.startTime)||typeof r.bootId!=='string'||!r.bootId||r.bootId.length>256||r.cwd!==undefined&&typeof r.cwd!=='string'||r.exitAt!==undefined&&(!Number.isFinite(r.exitAt)||r.exitAt<0))continue;this.records.set(r.id,{id:r.id,sessionKey:r.sessionKey,pid:r.pid,startTime:r.startTime,bootId:r.bootId,cwd:r.cwd,exitAt:r.exitAt});}}
 toJSON():LaunchRecord[]{return [...this.records.values()].map(r=>({...r}));}
}
