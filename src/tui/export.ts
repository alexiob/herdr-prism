import type {DashboardData} from './types.ts';
const availability=(value:unknown)=>['known','unavailable','partial','stale','not_applicable'].includes(String(value))?String(value):'unavailable';
const numeric=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:undefined;
const counter=(value:unknown)=>typeof value==='string'&&/^\d{1,30}$/.test(value)?value:undefined;
/** Explicit allow-list: diagnostic output never serializes transcript/config objects. */
export function diagnosticExport(data:DashboardData):string {
 const labels=new Map(data.sessions.slice(0,2048).map((s,index)=>[s.key,`session-${index+1}`]));
 return JSON.stringify({version:1,redacted:true,stale:data.stale===true,diagnosticCount:data.diagnostics.length,sessions:data.sessions.slice(0,2048).map(session=>({session:labels.get(session.key),parent:session.parentKey?labels.get(session.parentKey):undefined,provider:['codex','claude','pi'].includes(session.evidence.provider)?session.evidence.provider:'other',availability:availability(session.evidence.availability),messageCount:session.evidence.messages.length,toolCount:session.evidence.tools.length,descendantCount:session.children.length,resources:{availability:availability(session.resource?.availability),processCount:session.resource?.processes.length??0,cpuPercent:numeric(session.resource?.cpuPercent),residentBytes:counter(session.resource?.memoryBytes)},usage:{availability:availability(session.usage?.availability),input:numeric(session.usage?.input),output:numeric(session.usage?.output),cacheRead:numeric(session.usage?.cacheRead),cacheWrite:numeric(session.usage?.cacheWrite),total:numeric(session.usage?.total)}}))},null,2)+'\n';
}
