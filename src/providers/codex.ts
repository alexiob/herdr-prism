import {EvidenceBuilder,clean,codexTokens,filePath,hash,identity,json,number,object,time,visible} from './common.ts';
import {parseAccountLimits} from '../metrics/account-limits.ts';
import type {TailRecord} from './tail.ts';

export class CodexAdapter extends EvidenceBuilder {
 private exactThreadUsage=false;private lastExactUsageId?:string;private lastContext?:{contextUsed?:number;contextLimit?:number;model?:string};
 private ordinal=0;private firstOwnOrdinal=0;private startedTurnId?:string;private turnOpen=false;
 consume({record:r,offset}:TailRecord) {
 const ordinal=this.ordinal++;
 const p=object(r.payload);const source=this.source(offset);const timestamp=this.activity(r.timestamp);const e=this.evidence;
 if(r.type==='session_meta'){
 e.id=identity(p.id)||e.id;e.cwd=filePath(p.cwd);e.startedAt=time(p.timestamp)||timestamp;
 const spawn=object(object(object(p.source).subagent).thread_spawn);const alt=object(object(object(p.thread_source).subagent).thread_spawn);
 e.parentId=identity(p.parent_thread_id)||identity(spawn.parent_thread_id)||identity(alt.parent_thread_id);if(e.parentId)e.parentProvider='codex';e.parentSource=e.parentId?source:undefined;this.firstOwnOrdinal=number(p.subagent_history_start_ordinal)??0;return;
 }
 if(ordinal<this.firstOwnOrdinal)return;
 if(r.type==='turn_context'){e.model=clean(p.model,200)||e.model;e.cwd=filePath(p.cwd)||e.cwd;this.turnId=identity(p.turn_id)||identity(p.id)||this.turnId;return;}
 if(r.type==='response_item'){
 if(p.type==='agent_message'){
 const author=identity(p.author),recipient=identity(p.recipient);if(!author||!recipient||!Array.isArray(p.content)){this.diagnostic('inter-agent message schema unavailable');return;}
 // Mixed encrypted items are not complete plaintext messages. Never retain their prefix or ciphertext.
 const plaintext=p.content.length>0&&p.content.every((part:unknown)=>object(part).type==='input_text'&&typeof object(part).text==='string');const body=plaintext?visible(p.content):'';
 if(!body)this.diagnostic('inter-agent message body unavailable: encrypted, unsupported or empty content');
 this.message({id:identity(p.id)||`inter-agent:${source}`,role:'assistant',kind:'inter-agent',author,recipient,text:body||'Inter-agent message body unavailable',timestamp,cwd:e.cwd,source,complete:Boolean(body)});return;
 }
 if(p.type==='message'&&['user','assistant'].includes(p.role)&&p.channel!=='analysis'){
 const body=visible(p.content);if(!body)return;const id=identity(p.id)||`${source}`;
 // Canonical response items replace compatibility mirrors; text is never an event identity.
 for(const [key,m] of this.messages)if(key.startsWith('mirror:')&&m.role===p.role&&m.text===body)this.messages.delete(key);
 this.message({id,role:p.role,text:body,timestamp,cwd:e.cwd,source,complete:true});return;
 }
 if(['function_call','custom_tool_call'].includes(p.type)&&identity(p.call_id)&&identity(p.name)){this.call(p.call_id,p.name,p.arguments??p.input,timestamp);return;}
 if(['function_call_output','custom_tool_call_output'].includes(p.type)&&identity(p.call_id)){
 const result=json(p.output);this.result(p.call_id,p.output,Boolean(result.error)||result.success===false,source,timestamp);return;
 }return;
 }
 if(r.type==='token_usage_record'){
 const u=object(r.payload);const owner=identity(u.thread_id);if(owner!==e.id){this.diagnostic('token record rejected: thread owner does not match exact session');return;}const turnId=identity(u.turn_id);const counters=object(u.turn_token_usage);const turnCounters=turnId&&Object.keys(counters).length?codexTokens(counters):undefined;if(Object.keys(counters).length&&!turnId)this.diagnostic('turn counters unavailable: explicit turn identity missing');
 const threadCounters=codexTokens(u.thread_token_usage);
 if(threadCounters.input===undefined&&threadCounters.output===undefined&&threadCounters.total===undefined)return;
 // Legacy event totals and exact thread snapshots are different counters. Mixing
 // them invents a reset on every interleaved pair and repeatedly sums the lifetime.
 if(!this.exactThreadUsage){this.exactThreadUsage=true;for(const key of this.usage.keys())if(key.startsWith('count:'))this.usage.delete(key);}
 const id=`response:${identity(u.response_id)||offset}`;this.lastExactUsageId=id;
 const context=this.lastContext?.model===e.model?this.lastContext:undefined;
 this.usageRecord({id,sessionId:e.id,turnId,requestId:identity(u.response_id),model:e.model,timestamp,kind:'cumulative',...threadCounters,contextUsed:context?.contextUsed,contextLimit:context?.contextLimit,turnCounters,source,epoch:`thread:${e.id}`});return;
 }
 if(r.type!=='event_msg')return;
 if(p.type==='thread_goal_updated'){
 const goal=object(p.goal);const thread=identity(p.threadId);const created=number(goal.createdAt),updated=number(goal.updatedAt);const statuses:Record<string,string>={active:'active',paused:'paused',blocked:'blocked',complete:'complete',usageLimited:'usage_limited',budgetLimited:'budget_limited',usage_limited:'usage_limited',budget_limited:'budget_limited'};const status=typeof goal.status==='string'?statuses[goal.status]:undefined;const objective=clean(goal.objective,8192);
 if(!thread||thread!==e.id||goal.threadId!==thread||created===undefined||created>8640000000000||!status||!objective.trim()){this.diagnostic('explicit goal event unavailable: owner or schema mismatch');return;}
 const id=`goal:${thread}:${created}`;const at=updated!==undefined&&updated<=8640000000000?updated*1000:timestamp;const previous=e.goals.find(record=>record.id===id);if(previous?.timestamp!==undefined&&at!==undefined&&previous.timestamp>at)return;
 e.goals=e.goals.filter(record=>record.id!==id);e.goals.push({id,objective,status,timestamp:at,source});e.goals=e.goals.slice(-this.max);return;
 }
 if(['user_message','agent_message'].includes(p.type)){
 const role=p.type==='user_message'?'user':'assistant';const body=clean(p.message);if(body&&![...this.messages.values()].some(m=>m.role===role&&m.text===body))this.message({id:`mirror:${identity(p.id)||offset}`,role,text:body,timestamp,cwd:e.cwd,source,complete:true});return;
 }
 if(['task_started','turn_started'].includes(p.type)){this.turnId=identity(p.turn_id)||this.turnId;this.startedTurnId=this.turnId;this.turnOpen=true;const seconds=number(p.started_at);const startedAt=seconds!==undefined&&seconds<=8640000000000?seconds*1000:timestamp;this.turnStart=startedAt;e.activeTurn=startedAt!==undefined?{id:this.startedTurnId,startedAt,source}:undefined;e.state='running';return;}
 if(['task_complete','turn_complete','turn_aborted'].includes(p.type)){
 const completedId=identity(p.turn_id);const matched=this.turnOpen&&this.startedTurnId===completedId;const duration=number(p.duration_ms)??(matched&&timestamp!==undefined&&this.turnStart!==undefined&&timestamp>=this.turnStart?timestamp-this.turnStart:undefined);
 this.usageRecord({id:`turn:${completedId||offset}`,turnId:completedId,sessionId:e.id,model:e.model,timestamp,kind:'delta',turnMs:duration,source});if(matched||!this.turnOpen){if(this.turnId===completedId)this.turnId=undefined;e.state=p.error?'error':p.type==='turn_aborted'?'interrupted':'done';if(matched){e.activeTurn=undefined;this.turnStart=undefined;this.startedTurnId=undefined;this.turnOpen=false;}}return;
 }
 if(p.type==='token_count'&&Object.hasOwn(p,'rate_limits')&&timestamp!==undefined&&(e.accountObservedAt===undefined||timestamp>=e.accountObservedAt)){
  e.accountObservedAt=timestamp;e.accountLimits=parseAccountLimits('codex',e.id,p.rate_limits,timestamp,source);
 }
 if(p.type==='token_count'&&p.info){const info=object(p.info);
 const context=Object.fromEntries(Object.entries({contextUsed:number(object(info.last_token_usage).total_tokens),contextLimit:number(info.model_context_window)}).filter(([,value])=>value!==undefined));
 this.lastContext={...(this.lastContext?.model===e.model?this.lastContext:undefined),...context,model:e.model};
 if(this.exactThreadUsage){
  const current=this.lastExactUsageId?this.usage.get(this.lastExactUsageId):undefined;
  if(current&&current.model===e.model)this.usage.set(current.id,{...current,contextUsed:this.lastContext.contextUsed,contextLimit:this.lastContext.contextLimit});
  return;
 }
 const counters=codexTokens(info.total_token_usage);const id=hash(JSON.stringify([this.turnId,e.model,counters]));
 this.usageRecord({id:`count:${id}`,sessionId:e.id,turnId:this.turnId,model:e.model,timestamp,kind:'cumulative',...counters,contextUsed:this.lastContext.contextUsed,contextLimit:this.lastContext.contextLimit,source,epoch:`thread:${e.id}`});return;
 }
 if(p.type==='patch_apply_end'&&p.success===true){const id=identity(p.call_id)||`patch:${offset}`;const changes=object(p.changes);this.tool({id,name:'apply_patch',status:'done',timestamp,editedPaths:Object.keys(changes).filter(v=>identity(v)).slice(0,200),summary:'Patch applied'});}
 if(p.type==='error')e.state='error';
 }
}
