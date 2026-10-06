import type {Availability,UsageRecord,TokenCounters} from '../model/types.ts';
const fields=['input','output','cacheRead','cacheWrite','reasoning','total'] as const;
type Field=typeof fields[number];
export interface CostRate {currency:string;input?:number;output?:number;cacheRead?:number;cacheWrite?:number;}
export interface UsageOptions {rates?:Record<string,CostRate>;activeTurnId?:string;}
export interface TurnUsageSummary extends Partial<Record<Field,number>> {turnId:string;sessionId?:string;availability:Availability;coverage:{usable:number;total:number};source:'provider-turn'|'delta'|'cumulative-difference'|'unknown';cacheSemantics?:'subset'|'separate'|'unknown';diagnostics:string[];}
export interface UsageSummary extends Partial<Record<Field,number>> {availability:Availability;epochs:number;records:number;coverage:{usable:number;total:number};turnUsage?:TurnUsageSummary;cacheSemantics?:'subset'|'separate'|'unknown';contextUsed?:number;contextLimit?:number;contextPercent?:number;generationTokensPerSecond?:number;turnTokensPerSecond?:number;turnMs?:number;generationMs?:number;cost?:{amount:number;currency:string;availability:Availability};model?:string;recordedSince?:number;diagnostics:string[];scopeCoverage?:{reported:number;total:number};}
const valid=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const timingOnly=(r:UsageRecord)=>!fields.some(f=>r[f]!==undefined)&&(valid(r.turnMs)||valid(r.generationMs));
const backwards=(current:TokenCounters,previous:TokenCounters)=>fields.some(f=>valid(current[f])&&valid(previous[f])&&current[f]!<previous[f]!);
const counterTotal=(r:TokenCounters)=>valid(r.total)?r.total:valid(r.input)&&valid(r.output)&&(r.cacheSemantics==='subset'||!valid(r.cacheRead)&&!valid(r.cacheWrite))?r.input+r.output:r.cacheSemantics==='separate'&&valid(r.input)&&valid(r.output)?r.input+r.output+(r.cacheRead??0)+(r.cacheWrite??0):undefined;
/** Turn IDs identify attribution; a first lifetime snapshot never establishes a zero baseline. */
export function reduceTurnUsage(records:UsageRecord[],activeTurnId?:string):TurnUsageSummary|undefined {
 const dedup=new Map<string,UsageRecord>();
 for(const r of records){const key=JSON.stringify([r.sessionId??'',r.epoch??'',r.turnId??'',timingOnly(r)?'timing':'usage',r.kind==='delta'&&r.requestId&&!timingOnly(r)?r.requestId:r.id]);dedup.delete(key);dedup.set(key,r);}
 const ordered=[...dedup.values()].sort((a,b)=>a.timestamp!==undefined&&b.timestamp!==undefined?a.timestamp-b.timestamp:0);
 const latest=[...ordered].reverse().find(r=>r.turnId!==undefined&&(activeTurnId===undefined||r.turnId===activeTurnId));
 const turnId=activeTurnId??latest?.turnId;if(turnId===undefined)return undefined;
 const result:TurnUsageSummary={turnId,sessionId:latest?.sessionId,availability:'unavailable',coverage:{usable:0,total:0},source:'unknown',diagnostics:[]};
 if(!latest){result.diagnostics.push('No usage recorded for the requested turn');return result;}
 // A requested ID reused by different sessions cannot identify a single current turn.
 if(activeTurnId!==undefined&&new Set(ordered.filter(r=>r.turnId===turnId).map(r=>r.sessionId??'')).size>1){result.diagnostics.push('Turn ID is ambiguous across sessions');return result;}
 const direct=ordered.filter(r=>r.turnId===turnId&&(r.sessionId??'')===(latest.sessionId??'')&&r.turnCounters!==undefined);
 if(direct.length){
  const counters=direct.at(-1)!.turnCounters!;const reset=direct.some((r,i)=>i>0&&backwards(r.turnCounters!,direct[i-1]!.turnCounters!));
  for(const field of fields)if(valid(counters[field]))result[field]=counters[field];
  const usable=fields.some(field=>valid(counters[field]));result.coverage={usable:usable?1:0,total:1};result.cacheSemantics=counters.cacheSemantics??'unknown';result.total=reset?undefined:counterTotal(counters);result.availability=usable?(result.total!==undefined?'known':'partial'):'unavailable';result.source=usable?'provider-turn':'unknown';
  if(reset)result.diagnostics.push('Explicit provider turn counters moved backwards; the complete turn total is unavailable');
  else if(usable&&result.total===undefined)result.diagnostics.push('Explicit provider turn usage is partial');
  return result;
 }
 const tokens=ordered.filter(r=>(r.sessionId??'')===(latest.sessionId??'')&&!timingOnly(r));
 const contributions:UsageRecord[]=[];let unknown=0,derived=false;
 let block:{records:UsageRecord[];baseline?:UsageRecord}|undefined,previous:UsageRecord|undefined,lastCumulative:UsageRecord|undefined;
 const flush=()=>{
  if(!block)return;const entries=block.records;let lastIndex=-1;for(let i=entries.length-1;i>=0;i--)if(entries[i]!.kind==='cumulative'){lastIndex=i;break;}
  if(lastIndex<0)contributions.push(...entries);
  else {
   const current=entries[lastIndex]!,baseline=block.baseline;
   if(baseline&&!backwards(current,baseline)&&(current.cacheSemantics??'unknown')===(baseline.cacheSemantics??'unknown')){
    const difference:UsageRecord={...current,id:`turn-difference:${current.id}`,kind:'delta'};
    for(const f of fields){delete difference[f];if(valid(current[f])&&valid(baseline[f]))difference[f]=current[f]!-baseline[f]!;}
    contributions.push(difference,...entries.slice(lastIndex+1));derived=true;
   }else {unknown++;contributions.push(...entries.filter(r=>r.kind==='delta'));}
  }
  block=undefined;
 };
 for(const r of tokens){
  const reset=r.kind==='cumulative'&&lastCumulative!==undefined&&(r.epoch??'')===(lastCumulative.epoch??'')&&backwards(r,lastCumulative);
  if(block&&(r.turnId!==turnId||(r.epoch??'')!==(block.records[0]!.epoch??'')||reset))flush();
  if(r.turnId===turnId){if(!block){const baseline=previous?.kind==='cumulative'&&previous.turnId!==undefined&&previous.turnId!==turnId&&(previous.epoch??'')===(r.epoch??'')&&!reset?previous:undefined;block={records:[],baseline};}block.records.push(r);}
  if(r.kind==='cumulative')lastCumulative=r;previous=r;
 }
 flush();
 result.coverage={usable:contributions.filter(r=>fields.some(f=>valid(r[f]))).length,total:contributions.length+unknown};
 for(const f of fields){const values=contributions.map(r=>r[f]).filter(valid);if(values.length)result[f]=values.reduce((sum,v)=>sum+v,0);}
 const semantics=new Set(contributions.map(r=>r.cacheSemantics??'unknown'));result.cacheSemantics=semantics.size===1?[...semantics][0]:'unknown';
 const totals=contributions.map(r=>valid(r.total)?r.total:valid(r.input)&&valid(r.output)&&(r.cacheSemantics==='subset'||!valid(r.cacheRead)&&!valid(r.cacheWrite))?r.input+r.output:r.cacheSemantics==='separate'&&valid(r.input)&&valid(r.output)?r.input+r.output+(r.cacheRead??0)+(r.cacheWrite??0):undefined);
 if(!unknown&&totals.length&&totals.every(valid))result.total=totals.reduce((sum,v)=>sum+v,0);else delete result.total;
 const complete=!unknown&&contributions.length>0&&totals.every(valid);
 result.availability=result.coverage.usable?(complete?'known':'partial'):'unavailable';
 result.source=result.coverage.usable?(derived?'cumulative-difference':'delta'):'unknown';
 if(unknown)result.diagnostics.push('Cumulative turn counters lack a compatible prior explicit-turn baseline');
 if(result.coverage.usable&& !complete)result.diagnostics.push('Recorded turn usage is partial');
 return result;
}
/** Cumulative observations supersede preceding deltas in their counter epoch. No lifetime-completeness claim. */
export function reduceUsage(records:UsageRecord[],options:UsageOptions={}):UsageSummary {
 const dedup=new Map<string,UsageRecord>(); for(const r of records){const key=JSON.stringify([r.sessionId??'',r.epoch??'',timingOnly(r)?'timing':'usage',r.kind==='delta'&&r.requestId&&!timingOnly(r)?r.requestId:r.id]);dedup.delete(key);dedup.set(key,r);}
 const ordered=[...dedup.values()].sort((a,b)=>a.timestamp!==undefined&&b.timestamp!==undefined?a.timestamp-b.timestamp:0);
 const streams=new Map<string,{parts:UsageRecord[];last?:UsageRecord;identity:string;models:Set<string|undefined>;deltas:UsageRecord[]}>();const segments:UsageRecord[][]=[];const ambiguousCost=new Set<UsageRecord>();const pricedDeltas=new Map<UsageRecord,{records:UsageRecord[];end:number}>();
 for(const r of ordered){if(timingOnly(r))continue;const key=r.sessionId??'';const identity=r.epoch??'';let stream=streams.get(key);if(!stream||stream.identity!==identity){stream={parts:[],identity,models:new Set(),deltas:[]};streams.set(key,stream);segments.push(stream.parts);}
  if(r.kind==='cumulative'){
   if(stream.last&&fields.some(f=>valid(r[f])&&valid(stream!.last![f])&&r[f]!<stream!.last![f]!)){stream={parts:[],identity,models:new Set(),deltas:[]};streams.set(key,stream);segments.push(stream.parts);}
   if(stream.last){ambiguousCost.delete(stream.last);pricedDeltas.delete(stream.last);}
   stream.models.add(r.model);if(stream.models.size>1){ambiguousCost.add(r);pricedDeltas.set(r,{records:stream.deltas,end:stream.deltas.length});}
   stream.parts.splice(0,stream.parts.length,r);stream.last=r;
  }else {stream.models.add(r.model);stream.deltas.push(r);stream.parts.push(r);}
 }
 const contributions=segments.flat();const result:UsageSummary={availability:contributions.length?'known':'unavailable',epochs:segments.length,records:ordered.length,coverage:{usable:contributions.filter(r=>fields.some(f=>valid(r[f]))).length,total:contributions.length},diagnostics:[]};
 for(const f of fields){const values=contributions.map(r=>r[f]).filter(valid);if(values.length)result[f]=values.reduce((a,b)=>a+b,0);}
 if(result.coverage.usable!==result.coverage.total||contributions.some(r=>!valid(r.total)&&(!valid(r.input)||!valid(r.output)))){result.availability='partial';result.diagnostics.push('Some usage records lack usable token counters');}
 const semantics=new Set(contributions.map(r=>r.cacheSemantics??'unknown'));result.cacheSemantics=semantics.size===1?[...semantics][0]:'unknown';
 if(result.total===undefined&&contributions.length){let total=0,known=true;for(const r of contributions){if(!valid(r.input)||!valid(r.output)){known=false;break;}const cache=valid(r.cacheRead)||valid(r.cacheWrite);if(cache&&r.cacheSemantics!=='subset'&&r.cacheSemantics!=='separate'){known=false;break;}total+=r.input+r.output+(r.cacheSemantics==='separate'?(r.cacheRead??0)+(r.cacheWrite??0):0);}if(known)result.total=total;}
 // Mixed explicit and absent totals cannot be presented as a complete total.
 if(contributions.some(r=>valid(r.total))&&contributions.some(r=>!valid(r.total))){const derived=contributions.map(r=>valid(r.total)?r.total:valid(r.input)&&valid(r.output)&&(r.cacheSemantics==='subset'||!valid(r.cacheRead)&&!valid(r.cacheWrite))?r.input+r.output:r.cacheSemantics==='separate'&&valid(r.input)&&valid(r.output)?r.input+r.output+(r.cacheRead??0)+(r.cacheWrite??0):undefined);result.total=derived.every(valid)?derived.reduce((s,x)=>s+x,0):undefined;}
 const latest=ordered.at(-1);const context=[...ordered].reverse().find(r=>!timingOnly(r));if(latest){result.model=[...ordered].reverse().find(r=>r.model!==undefined)?.model;if(context&&context.model===result.model&&valid(context.contextUsed)){result.contextUsed=context.contextUsed;if(valid(context.contextLimit)&&context.contextLimit>0){result.contextLimit=context.contextLimit;result.contextPercent=100*context.contextUsed/context.contextLimit;}}
 }
 // Duration-only observations remain useful timing evidence, but cannot supply token counters.
 const latestTurn=[...ordered].reverse().find(r=>valid(r.turnMs));const latestGeneration=[...ordered].reverse().find(r=>valid(r.generationMs));
 result.turnMs=latestTurn?.turnMs;result.generationMs=latestGeneration?.generationMs;
 // Only a single delta record carrying both tokens and its compatible measured timer yields a rate.
 // A separate completion event or cumulative output must never be interpreted as generation speed.
 if(latest?.kind==='delta'&&valid(latest.output)){if(valid(latest.generationMs)&&latest.generationMs>0)result.generationTokensPerSecond=latest.output*1000/latest.generationMs;if(valid(latest.turnMs)&&latest.turnMs>0)result.turnTokensPerSecond=latest.output*1000/latest.turnMs;}
 const times=ordered.map(r=>r.timestamp).filter(valid);if(times.length)result.recordedSince=Math.min(...times);
 const uncertainPricing=contributions.some(r=>ambiguousCost.has(r));const pricing=contributions.flatMap(r=>{if(!ambiguousCost.has(r))return [r];const prefix=pricedDeltas.get(r);return prefix?prefix.records.slice(0,prefix.end):[];});if(uncertainPricing)result.diagnostics.push('Cumulative counters span models without complete per-model billing attribution');
 if(options.rates&&contributions.length){let amount=0,partial=uncertainPricing,currency:string|undefined;for(const r of pricing){const rate=r.model?options.rates[r.model]:undefined;if(!rate){partial=true;continue;}if(currency&&currency!==rate.currency){result.diagnostics.push('Mixed cost currencies');currency=undefined;partial=true;break;}currency=rate.currency;
   let input=r.input;if(r.cacheSemantics==='subset'&&valid(input))input=Math.max(0,input-(r.cacheRead??0)-(r.cacheWrite??0));if((valid(r.cacheRead)||valid(r.cacheWrite))&&(r.cacheSemantics==='unknown'||r.cacheSemantics===undefined)){partial=true;input=undefined;}
   for(const [field,value]of [['input',input],['output',r.output],['cacheRead',r.cacheRead],['cacheWrite',r.cacheWrite]] as const){if(!valid(value)){if(field==='input'||field==='output')partial=true;continue;}const price=rate[field];if(valid(price))amount+=value*price/1000000;else if(value>0)partial=true;}
  }if(currency)result.cost={amount,currency,availability:partial?'partial':'known'};
 }
 result.turnUsage=reduceTurnUsage(records,options.activeTurnId);
 return result;
}
export interface UsageSession {key:string;parentKey?:string;records:UsageRecord[];}
export function reduceUsageScope(sessions:UsageSession[],options:UsageOptions={}):UsageSummary {
 const unique=new Map(sessions.map(s=>[s.key,s]));const included:UsageRecord[]=[];let unknown=false;
 for(const session of unique.values()){let parent=session.parentKey?unique.get(session.parentKey):undefined;const seen=new Set<string>();let covered=false;
  while(parent&&!seen.has(parent.key)){seen.add(parent.key);const tokenRecords=parent.records.filter(r=>!timingOnly(r));const inclusion=new Set(tokenRecords.map(r=>r.includesChildren));if(inclusion.has(true)){if(inclusion.size===1){covered=true;break;}unknown=true;}if(tokenRecords.length&&inclusion.has(undefined))unknown=true;parent=parent.parentKey?unique.get(parent.parentKey):undefined;}
  if(!covered)included.push(...session.records.map(r=>({...r,sessionId:r.sessionId??session.key})));
 }
 const result=reduceUsage(included,options);result.scopeCoverage={reported:[...unique.values()].filter(s=>s.records.some(r=>!timingOnly(r))).length,total:unique.size};if(result.scopeCoverage.reported<result.scopeCoverage.total&&result.availability!=='unavailable'){result.availability='partial';result.diagnostics.push('Selected sessions lack recorded usage');}if(unknown){for(const f of fields)delete result[f];result.availability='partial';result.cost=undefined;result.diagnostics.push('Parent usage child-inclusion semantics unavailable');}return result;
}
