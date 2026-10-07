import {sessionName} from './identity.ts';
import {resolveNotesSessionKey} from '../runtime/follow.ts';
import {outputHelp} from '../process/output.ts';
import {accountRows} from './account.ts';
import type {DashboardData,SessionView,UiState,ScreenRow,DetailDocument,DetailSection,DetailField,UiRef} from './types.ts';
import type {OwnedProcess} from '../process/ownership.ts';
import type {Message} from '../model/types.ts';
import type {ColorRole} from './theme.ts';
import {age,number,bytes,spark,cellWidth} from './text.ts';
import {documentText,meter,pad} from './widgets.ts';
import {resourceChart} from './resource-charts.ts';
export const unavailable='—';
export const field=(label:string,value:unknown,role?:ColorRole):DetailField=>({label,value:value===undefined||value===null?'—':String(value),role});
const section=(id:string,title:string,fields:DetailField[],column:0|1=0):DetailSection=>({id,title,fields,column});
export function resident(value?:string):string{try{if(value!==undefined&&BigInt(value)>0n&&BigInt(value)<1048576n)return `${number(Number(BigInt(value))/1024)}KiB`;}catch{return '—';}return bytes(value);}
const duration=(ms?:number)=>ms===undefined||!Number.isFinite(ms)||ms<0?'—':number(ms/1000)+'s';
const percent=(value?:number)=>value===undefined?'—':number(value)+'%';
const aggregateCpu=(session:SessionView)=>session.resource?.cpuPercent!==undefined?percent(session.resource.cpuPercent):session.resource?.cpuLowerBound!==undefined?'≥'+percent(session.resource.cpuLowerBound):'—';
const iso=(timestamp?:number)=>timestamp===undefined||!Number.isFinite(timestamp)||Math.abs(timestamp)>8640000000000000?'—':new Date(timestamp).toISOString();
const statusRole=(value?:string):ColorRole=>value==='known'||value==='active'||value==='done'?'positive':value==='unavailable'||value==='partial'||value==='stale'?'warning':'text';
export const rowHelp:Record<string,string>={
 cpu:'Sampled user + kernel CPU delta over monotonic elapsed. 100% = one logical core; the aggregate can exceed 100%. The first sample needs warmup. Only verified owned processes count. ≥ marks a measured lower bound when some owned processes are warming up or unreadable; it is not a complete total. History can include these labeled partial observations. History spans the observed period, up to 15 minutes, newest at right. Each column shows its last measured sample; a missing current reading does not erase earlier measurements. Explicit sampling gaps clear columns. Blanks are unobserved intervals or explicit gaps, never interpolated; measured zero uses a baseline mark. CPU chart full scale is at least one core and grows in whole cores. Enter opens the exact period, last measurement time and scale.',
 memory:'Cumulative RSS of the selected agent and all verified owned processes on Unix; working-set sum on Windows. u additionally includes recorded sub-agent sessions. Each process counts once, but shared pages can occur in several processes. Peak is the highest observed aggregate sample, not lifetime allocation. The chart uses bytes from zero to its observed chart peak, not host memory percentage. History spans the observed period, up to 15 minutes, newest at right. Each column shows its last measured sample; current availability is separate. Explicit sampling gaps clear columns. Blanks are unobserved intervals or explicit gaps; measured zero uses a baseline mark. Enter opens measurements, last measurement time, period, scale and scope.',
 coverage:'Readable/total verified process coverage. Unreadable processes remain in the denominator. A missing required CPU sample leaves the complete aggregate unavailable; ≥ shows the measured lower bound when available. Enter opens Processes; u changes scope.',
 tokens:'Recorded provider observations. Repeated cumulative counters are not added twice. Cache can be a subset of input or a separate category. Retained observations do not establish lifetime completeness. Enter opens all usage facts.',
 context:'Measured current-context occupancy, separate from lifetime consumption. Percent requires a compatible actual capacity and current measurement. Enter opens exact counters and available provenance.',
 'turn-tokens':'Current or last recorded turn usage uses explicit turn IDs, compatible deltas or a prior-turn cumulative baseline. A first lifetime snapshot does not establish a turn total. Enter opens counters, coverage and reduction provenance.',
 goal:'An explicitly reported goal, with its status and source. Initial user requests and delegated tasks are separate. Enter opens complete work facts and recorded requests.',
 task:'An explicitly delegated task is distinct from a goal. Enter opens its full text and agent identity.',
 'process-uptime':'Harness uptime needs a measured lifetime for the verified harness of this exact session. Current-turn elapsed needs a sourced explicit boundary. Future or unsourced boundaries are unavailable. Enter opens timings and sources.',
 messages:'These counts cover retained user/assistant messages and tools. Inter-agent messages remain separate. Enter opens Messages; b loads older history without jumping a scrollback reader.',
 children:'All descendants in the reconciled lineage, with cycles excluded. Enter opens Agents. Enter there inspects within Prism; f explicitly focuses a live pane. Numeric targets refer to Prism, not native Herdr focus indices.',
 refs:'Retained or paged reference targets; coverage is labeled. Enter opens Refs. Target details retain the complete path; Space loads mention sources and s opens the exact source cursor.',
 todo:`What To-do contains
Actions reported for you by this agent. This is a local checklist, separate from the harness's internal plan and task tools. Prism imports ACTION: lines from complete assistant messages outside a code block. User, tool and inter-agent messages do not create items.

How to populate it
Ask the agent: "Report the complete current list of actions for me. Use one ACTION: <description> line per item outside a code block, or ACTION: none if no actions remain."
Example:
ACTION: Review the diff
ACTION: Run the test suite

How reports change the list
The latest complete ACTION report replaces the current list. ACTION: none explicitly clears it. Items missing from that report are archived; messages without ACTION lines leave the list unchanged. An empty reported list differs from not_reported, source_unavailable and disabled. A repeated identical item keeps its local checkmark.

Local checks and provenance
[x] means you checked the item in Prism. It does not change the transcript, tell the agent it is done, or prove that the agent completed work. Checkmarks persist per agent across restarts. Pending counts include only unchecked current items. First seen is the original request time; list age is the latest report time. Full details retain first/latest source and repeated-request markers.

Keys
From Overview, Enter opens To-do. In the list, arrows or j/k select a request; Enter opens the full text and provenance. x checks or reopens it; completed items sort below pending items. s opens its recorded source message. y copies a single inline backtick command when there is exactly one, otherwise the full request; copying does not run it. ? opens this help. Escape returns to the saved reader; Tab changes views; q closes the panel.

Configuration
ACTION parsing is enabled by default. Prism's settings.json has a top-level todosEnabled boolean. Set it to false to disable parsing, or true to enable it; preserve the other settings. Then restart Prism through activate-overview (or activate-inspector for inspector-only mode). reload-settings applies ui.tabOrder and ui.nativeGrouping.`,
 git:'Git facts belong to this exact checkout and repository family. Added/deleted lines differ from untracked file counts. Missing counters are unavailable. Enter opens Git.',
 notes:'Private per-agent Markdown on the collecting server. Enter opens Notes, then Enter edits. Autosave after 500 ms; Ctrl+S flushes. Follow is held while editing. Complete Prism state removal deletes notes.',
};
export function historyValues(session:SessionView,kind:'cpu'|'memory',width:number,now:number):(number|undefined)[]{
 return resourceChart(session.history,kind,width,now).values;
}
function resourceHistory(session:SessionView,kind:'cpu'|'memory',width:number,ascii:boolean,now:number){
 const data=resourceChart(session.history,kind,width,now),values=data.values,valid=values.filter((value):value is number=>value!==undefined);
 const peak=valid.length?Math.max(...valid):undefined;
 // CPU uses one logical core as the minimum full scale. Memory is a byte
 // trend against the observed chart peak, never a percentage of host RAM.
 const ceiling=peak===undefined?undefined:kind==='cpu'?Math.max(100,Math.ceil(peak/100)*100):Math.max(1,peak);
 const period=data.period,chart=!valid.length&&data.measuredCount?'sampling gaps':spark(values,width,ascii,ceiling);
 return {chart,fields:[
  field('History',chart,'quantity'),
  field('Period',period?`${duration(period.to-period.from)} observed · ending ${iso(period.to)}`:values.length?`Recent ${values.length} samples · timestamps unavailable`:'No recorded samples','duration'),
  field('Last measured',iso(data.latestMeasuredAt),'duration'),
  field('Measured samples',data.measuredCount,'quantity'),
  ...(kind==='cpu'&&data.partialCount?[field('Partial samples',data.partialCount,'warning'),field('Partial history','Includes measured lower bounds (≥), not complete totals.')]:[]),
  field('Sampling',`Last measured sample per column; current availability is separate. Explicit gaps clear columns (${data.explicitGaps} recorded).`),
  field('Scale',ceiling===undefined?data.measuredCount?'Unavailable while chart columns contain only gaps':'Unavailable until measured':kind==='cpu'?`0–${percent(ceiling)}`:`0–${resident(BigInt(Math.floor(ceiling)).toString())} · observed chart peak, not host %`,'quantity'),
 ]};
}
export function descendants(data:DashboardData,session:SessionView):SessionView[]{const graph=new Map(data.sessions.map(s=>[s.key,s])),seen=new Set([session.key]),queue=[...session.children],result:SessionView[]=[];for(let i=0;i<queue.length;i++){const key=queue[i]!;if(seen.has(key))continue;seen.add(key);const node=graph.get(key);if(node){result.push(node);queue.push(...node.children);}}return result;}
export function identityDocument(session:SessionView,data:DashboardData,now:number):DetailDocument{
  const graph=new Map(data.sessions.map(s=>[s.key,s])),path:string[]=[],seen=new Set<string>();let node:SessionView|undefined=session;while(node&&!seen.has(node.key)){seen.add(node.key);path.push(node.evidence.title??node.evidence.id);node=node.parentKey?graph.get(node.parentKey):undefined;}
  return {title:'Agent identity',capturedAt:now,sections:[section('identity','Identity',[field('Name',session.evidence.title,'identity'),field('Provider',session.evidence.provider,'identity'),field('Session',session.evidence.id,'identity'),field('Model',session.evidence.model??session.usage?.model,'identity'),field('State',session.evidence.state,statusRole(session.evidence.state)),field('Depth',session.depth,'quantity')]),section('lineage','Lineage',[field('Parent',session.parentKey??(session.evidence.parentId?`${session.evidence.parentProvider??session.evidence.provider}:${session.evidence.parentId}`:'Not reported'),'identity'),field('Source',session.evidence.parentSource,'identity'),field('Breadcrumb',path.reverse().join(' › '),'identity')],1),section('checkout','Checkout',[field('Family',session.git?.familyKey,'path'),field('Worktree',session.git?.root??session.evidence.cwd,'path'),field('Branch',session.git?.branch??session.git?.branchState,'identity')],1)]};
}
export function resourceDocument(session:SessionView,id:string,state:UiState,now:number):DetailDocument{
 const r=session.resource,history=session.history;
 const doc:DetailDocument={title:id==='cpu'?'CPU':id==='coverage'||id==='scope'?'Process coverage':'Memory',capturedAt:now,sections:[]};
 if(id==='cpu')doc.sections.push(section('cpu','CPU',[field('Current',aggregateCpu(session),'quantity'),...resourceHistory(session,'cpu',22,state.ascii,now).fields]));
 else if(id!=='coverage'&&id!=='scope')doc.sections.push(section('memory','Memory',[field('Metric',r?.memoryLabel,'identity'),field('Current',resident(r?.memoryBytes),'quantity'),field('Peak',resident(history?.peakMemoryBytes),'quantity'),...resourceHistory(session,'memory',22,state.ascii,now).fields]));
 doc.sections.push(section('scope','Sample scope',[field('Includes',state.subtree?'Selected agent + descendants + owned jobs':'Selected agent + owned jobs'),field('Status',r?.availability,statusRole(r?.availability)),field('Shared with',r?.sharedWith,'identity'),field('Sample',iso(r?.sampledAt),'duration'),field('Reason',r?.reason)],1));
 doc.sections.push(section('coverage','Readable samples',[field('Processes',r?.coverage?`${r.coverage.readable}/${r.coverage.total} readable`:'—',r?.availability==='known'?'positive':'warning'),field('CPU',r?.cpuCoverage?`${r.cpuCoverage.readable}/${r.cpuCoverage.total} readable`:'—','quantity'),field('Unreadable',r?.unreadablePids?.length? r.unreadablePids.join(', '):r?'None reported':'—','identity')],1));
 return doc;
}
export function usageDocument(session:SessionView,now:number):DetailDocument{
 const u=session.usage,t=u?.turnUsage,e=session.evidence,turnName=e.activeTurn?.id===t?.turnId&&t?'Current turn':'Last recorded turn';
 const sections:DetailSection[]=[section('tokens','Recorded tokens',[...(['input','output','cacheRead','cacheWrite','reasoning','total'] as const).map((key,i)=>field(['Input','Output','Cache read','Cache write','Reasoning','Total'][i]!,u?.[key]===undefined?'—':number(u[key])+' tokens','quantity')),field('Cache mode',u?.cacheSemantics,'identity')]),section('context','Context',[field('Used',u?.contextUsed===undefined?'—':number(u.contextUsed)+' tokens','quantity'),field('Capacity',u?.contextLimit===undefined?'—':number(u.contextLimit)+' tokens','quantity'),field('Occupancy',percent(u?.contextPercent),'quantity'),field('Meter',meter(u?.contextPercent,12),'quantity')],1),section('rates','Rates and cost',[field('Generation',u?.generationTokensPerSecond===undefined?'—':number(u.generationTokensPerSecond)+' tokens/s','quantity'),field('Throughput',u?.turnTokensPerSecond===undefined?'—':number(u.turnTokensPerSecond)+' tokens/s','quantity'),field('Cost',u?.cost?`${u.cost.currency} ${u.cost.amount.toFixed(4)} (${u.cost.availability})`:'—','quantity')],1),section('provenance','Provenance',[field('Availability',u?.availability,statusRole(u?.availability)),field('Coverage',u?.coverage?`${u.coverage.usable}/${u.coverage.total} usable observations`:'—','quantity'),field('Since',iso(u?.recordedSince),'duration'),field('Scope',u?.scopeCoverage?`${u.scopeCoverage.reported}/${u.scopeCoverage.total} sessions reported`:'Selected session')])];
 if(t){sections.push(section('turn',turnName,[field('Turn ID',t.turnId,'identity'),...(['input','output','cacheRead','cacheWrite','reasoning','total'] as const).map((key,i)=>field(['Input','Output','Cache read','Cache write','Reasoning','Total'][i]!,t[key]===undefined?'—':number(t[key])+' tokens','quantity')),field('Status',t.availability,statusRole(t.availability)),field('Coverage',`${t.coverage.usable}/${t.coverage.total} observations`,'quantity'),field('Reduction',t.source,'identity'),field('Sources',e.usage.filter(record=>record.turnId===t.turnId&&record.source).slice(-10).map(record=>record.source).join('\n')||'—'),field('Diagnostics',t.diagnostics.join('\n')||'None reported')],1));}
 if(u?.diagnostics?.length)sections.push({id:'diagnostics',title:'Recorded diagnostics',text:u.diagnostics.join('\n'),column:0});
 return {title:'Recorded usage',sections,capturedAt:now};
}
export function timingValues(session:SessionView,now:number){const active=session.evidence.activeTurn;const elapsed=active?.source&&Number.isFinite(active.startedAt)&&active.startedAt>=0&&active.startedAt<=8640000000000000&&active.startedAt<=now?now-active.startedAt:undefined;const harnesses=session.resource?.processes.filter(p=>p.isHarness&&p.owner===session.key&&p.availability!=='unavailable')??[];return {elapsed,uptime:harnesses.length===1?harnesses[0]?.uptimeMs:undefined};}
export function timingDocument(session:SessionView,now:number):DetailDocument{const {elapsed,uptime}=timingValues(session,now),e=session.evidence,u=session.usage;return {title:'Timings',capturedAt:now,sections:[section('session','Session',[field('Age',age(e.startedAt,now),'duration'),field('Activity',age(e.lastActivity,now),'duration'),field('Uptime',duration(uptime),'duration')]),section('turn','Turn',[field('Elapsed',duration(elapsed),'duration'),field('Reported turn',duration(u?.turnMs),'duration'),field('Generation',duration(u?.generationMs),'duration'),field('Turn ID',e.activeTurn?.id,'identity'),field('Started',elapsed===undefined?'—':iso(e.activeTurn?.startedAt),'duration'),field('Source',e.activeTurn?.source,'identity')],1)]};}
export function gitDocument(session:SessionView,now:number):DetailDocument {const g=session.git;return {title:'Git checkout',capturedAt:now,sections:[section('identity','Checkout identity',[field('Branch',g?.branch??g?.branchState,'identity'),field('HEAD',g?.head,'identity'),field('Repository',g?.root,'path'),field('Worktree',g?.cwd??session.evidence.cwd,'path'),field('Family',g?.familyKey,'path'),field('Checkout ID',g?.checkoutKey,'identity')]),section('changes','Changes',[field('Added',g?.added===undefined?'—':'+'+g.added+' lines','positive'),field('Deleted',g?.deleted===undefined?'—':'-'+g.deleted+' lines','negative'),field('Untracked',g?.untrackedFiles===undefined?'—':g.untrackedFiles+' files','quantity'),field('Conflicts',number(g?.conflicts),g?.conflicts===0?'positive':'negative'),field('Changed',number(g?.changedFiles),'quantity'),field('Binary',number(g?.binaryFiles),'quantity'),field('Staged',number(g?.stagedFiles),'quantity'),field('Unstaged',number(g?.unstagedFiles),'quantity')],1),section('tracking','Tracking',[field('Upstream',g?.upstream,'identity'),field('Ahead',number(g?.ahead),'quantity'),field('Behind',number(g?.behind),'quantity')],1),section('snapshot','Snapshot',[field('Status',g?.availability,statusRole(g?.availability)),field('Sample',iso(g?.sampledAt),'duration'),field('Age',age(g?.sampledAt,now),'duration'),field('Reason',g?.reason)])]};}
export function workDocument(session:SessionView,id:string,data:DashboardData,now:number):DetailDocument{
 const e=session.evidence,g=e.goals.at(-1),doc:DetailDocument={title:id==='task'?'Delegated task':'Work',capturedAt:now,sections:[]};
 doc.sections.push({id:'objective',title:id==='task'?'Delegated task':'Explicit goal',text:id==='task'?e.task??'No task reported':g?.objective??'No explicit goal reported'});
 if(g&&id!=='task')doc.sections.push(section('goal-facts','Goal record',[field('Status',g.status,statusRole(g.status)),field('Source',g.source,'identity'),field('Reported',iso(g.timestamp),'duration')],1));
 if(e.initialRequest)doc.sections.push({id:'initial',title:'Initial user request',text:e.initialRequest.text,column:1});
 else {doc.sections.push({id:'initial',title:'Initial user request',text:'Unavailable from bounded prefix',column:1});const earliest=e.messages.find(message=>message.role==='user');if(earliest)doc.sections.push({id:'retained',title:'Earliest retained user message',text:earliest.text,column:1});}
 doc.sections.push(...identityDocument(session,data,now).sections.map(s=>({...s,id:'agent-'+s.id,column:1 as const})));
 return doc;
}
export function processDocument(session:SessionView,process:OwnedProcess,now:number):DetailDocument{
 const denied=process.availability==='unavailable',target=denied?undefined:{key:process.key,owner:process.owner,pid:process.pid,name:process.name,isHarness:process.isHarness};const doc:DetailDocument={processTarget:target,help:'Shift+K asks to terminate this exact process. Cancel is selected initially. Only this PID is signaled; killing a harness can end its agent session. Escape returns.',title:'Process details',capturedAt:now,sections:[section('identity','Identity',[field('Name',process.name,'identity'),field('PID',process.pid,'identity'),field('PPID',process.ppid,'identity'),field('Birth',process.startTime,'identity'),field('Identity',process.key,'identity')]),section('resources','Resources',[field('CPU',percent(denied?undefined:process.cpuPercent),'quantity'),field(session.resource?.memoryLabel==='working-set sum'?'WS':'RSS',resident(denied?undefined:process.rssBytes),'quantity'),field('Threads',number(denied?undefined:process.threads),'quantity'),field('Uptime',duration(denied?undefined:process.uptimeMs),'duration'),field('Read bytes',denied?'—':process.readBytes,'quantity'),field('Write bytes',denied?'—':process.writeBytes,'quantity'),field('Status',process.availability??'known',statusRole(process.availability??'known'))],1),section('ownership','Ownership',[field('Agent',process.owner,'identity'),field('Harness',process.isHarness?'Verified root':'Owned process')])]};
 doc.sections.push({id:'output',title:'Output',column:0,text:target?'Loading retained shared terminal output…':'Output unavailable: process sample is unreadable',rows:target?[{id:'process-output-refresh',text:'Refresh shared terminal output',help:outputHelp,action:{type:'process-output',sessionKey:session.key,processTarget:target}}]:[]});
 doc.help=(doc.help??'')+' '+outputHelp;return doc;
}
export function referenceDocument(session:SessionView,ref:UiRef,now:number):DetailDocument{
 const open:ScreenRow={id:'ref-open:'+ref.id,text:'Open target',help:'Open this target with the configured file/browser opener. Nothing executes as a shell command.',action:{type:'open-ref',sessionKey:session.key,id:ref.id,target:ref.target,line:ref.line}};
 const mentions:ScreenRow={id:'ref-mentions:'+ref.id,text:'Mention history',help:'Load mentions using exact historical cursors. Source messages retain file/offset/hash identity.',action:{type:'ref-sources',sessionKey:session.key,id:ref.id}};
 const source:ScreenRow={id:'ref-source:'+ref.id,text:'Source message',help:'Open this exact source message. A historical reference cursor is routed to its original record.',action:{type:'source',sessionKey:session.key,id:ref.messageId,referenceCursor:ref.cursor}};
 return {title:'Reference target',capturedAt:now,sections:[section('target','Reference target',[field('Name',ref.target.replace(/[\\/]+$/,'').split(/[\\/]/).at(-1),'identity'),field('Path',ref.target,'path'),field('Line',ref.line,'quantity'),field('Kind',ref.kind,'identity')]),section('facts','Recorded facts',[field('State',ref.exists===false?'Missing target':ref.exists===true?'Exists':'Presence not checked',ref.exists===false?'warning':'text'),field('Edited',ref.edited?'Yes':'No'),field('Message',ref.messageId,'identity'),field('Source',ref.source,'path'),field('Coverage',session.refCoverage??'retained','identity'),field('Mentions',ref.sources?.length,'quantity')],1),{id:'actions',title:'Actions',rows:[open,mentions,source],column:1}]};
}
export function factRow(id:string,label:string,value:string,document:DetailDocument,help:string,section:string,column:0|1=0,role?:ColorRole):ScreenRow{const facts={...document,help};return {id,text:label+': '+value,label,value,help,section,column,role,document:facts,action:{type:'message',text:documentText(facts),document:facts}};}
export function messageDocument(message:Message,now=Date.now()):DetailDocument{return {title:message.kind==='inter-agent'?'Agent message':message.role+' message',capturedAt:now,help:'Recorded message content and associated tools. Escape returns to the saved reader position; y copies a selected value when available.',sections:[{id:'body',title:message.role==='tool'?'Tool result':message.kind==='inter-agent'?'Agent message':'Message',text:message.text},{id:'facts',title:'Recorded facts',column:1,fields:[field('Role',message.role,'identity'),field('Message',message.id,'identity'),field('Author',message.author,'identity'),field('Recipient',message.recipient,'identity'),field('Source',message.source,'path'),field('Recorded',iso(message.timestamp),'duration'),field('Complete',message.complete===undefined?'Not reported':message.complete?'Yes':'Partial',message.complete===false?'warning':'text')]},...(message.tools??[]).map((tool,i)=>({id:'tool-'+i,title:'Tool · '+tool.name,column:1 as const,fields:[field('Call ID',tool.id,'identity'),field('State',tool.status,tool.status==='error'?'negative':tool.status==='done'?'positive':'text')],text:tool.summary??'No recorded result'}))]};}
export function overviewRows(session:SessionView,state:UiState,now:number,data:DashboardData):ScreenRow[]{
 const e=session.evidence,r=session.resource,u=session.usage,t=timingValues(session,now),desc=descendants(data,session),rows:ScreenRow[]=[];
 const add=(id:string,label:string,value:string,doc:DetailDocument,section:string,column:0|1,role?:ColorRole)=>rows.push(factRow(id,label,value,doc,rowHelp[id]??'Enter opens full recorded facts; ? explains the selected entry.',section,column,role));
 const link=(id:string,label:string,value:string,tab:import('./types.ts').Tab,section:string,column:0|1=1)=>rows.push({id,text:label+': '+value,label,value,section,column,help:rowHelp[id],action:{type:'tab',tab}});
 add('goal','Goal',e.goals.at(-1)?.objective??'Not reported',workDocument(session,'goal',data,now),'Work',1);
 if(e.task)add('task','Task',e.task,workDocument(session,'task',data,now),'Work',1);
 add('process-uptime','Timing',`Harness uptime ${duration(t.uptime)} · current turn ${duration(t.elapsed)}`,timingDocument(session,now),'Work',1,'duration');
 rows.at(-1)!.value=`${age(e.startedAt,now)} session · ${duration(t.elapsed)} turn`;
 const recordedWorker=state.boundSessionKey&&session.key!==state.boundSessionKey&&!session.attachment&&!session.attachments?.length&&!r?.processes.length;
 if(recordedWorker){
  const owner=data.sessions.find(value=>value.key===state.boundSessionKey);
  rows.push({id:'resource-owner',section:'Resources',column:0,label:'Processes',value:'No live process · return to '+sessionName(owner),text:'No live process · return to '+sessionName(owner),role:'warning',help:'This is a recorded worker with no live process. Its CPU and RSS cannot be measured. Enter returns to the owning agent and its live resources. Esc or Backspace returns to the parent; Shift+F returns directly to the owning agent. These actions do not focus another native pane.',action:{type:'follow-bound',sessionKey:state.boundSessionKey}});
 }else{
 const cpuValue=aggregateCpu(session),memoryValue=resident(r?.memoryBytes),metricWidth=Math.max(8,cellWidth(cpuValue),cellWidth(memoryValue));
 add('cpu','CPU',`${pad(cpuValue,metricWidth)} ${resourceHistory(session,'cpu',8,state.ascii,now).chart}`,resourceDocument(session,'cpu',state,now),'Resources',0,'quantity');
 add('memory',r?.memoryLabel==='working-set sum'?'WS sum':'RSS sum',`${pad(memoryValue,metricWidth)} ${resourceHistory(session,'memory',8,state.ascii,now).chart}`,resourceDocument(session,'memory',state,now),'Resources',0,'quantity');
 rows.at(-1)!.gapBefore=1;
 link('coverage','Processes',r?.coverage?`${r.coverage.readable}/${r.coverage.total} readable`:'—','Processes','Resources',0);
 }
 add('context','Context',u?.contextPercent===undefined?'—':percent(u.contextPercent)+' '+meter(u.contextPercent,8,state.ascii),usageDocument(session,now),'Usage',0,'quantity');
 add('tokens','Tokens',`in ${number(u?.input)} · out ${number(u?.output)}`,usageDocument(session,now),'Usage',0,'quantity');
 const turn=u?.turnUsage;if(turn)add('turn-tokens',e.activeTurn?.id===turn.turnId?'Current turn':'Last recorded turn',`in ${number(turn.input)} · out ${number(turn.output)}`,usageDocument(session,now),'Usage',0,'quantity');
 rows.push(...accountRows(session,state,now));
 link('git','Git',`${session.git?.branch??session.git?.branchState??'—'} +${number(session.git?.added)} -${number(session.git?.deleted)}`,'Git','Checkout');
 rows.at(-1)!.value=session.git?`+${number(session.git.added)} -${number(session.git.deleted)} · ${number(session.git.conflicts)} conflicts`:'Unavailable';
 const statuses=[...new Set(desc.map(s=>s.evidence.state??'unknown'))].map(status=>`${status} ${desc.filter(s=>(s.evidence.state??'unknown')===status).length}`).join(' · ');
 link('children','Agents',`${desc.length} descendants${statuses?' · '+statuses:''}`,'Agents','Activity');
 rows.at(-1)!.value=`${desc.length} descendants`;
 const messages=e.messages.filter(m=>m.kind!=='inter-agent');link('messages','Messages',`U${messages.filter(m=>m.role==='user').length} A${messages.filter(m=>m.role==='assistant').length} · ${e.tools.length} tools`,'Messages','Activity'); rows.at(-1)!.text='retained messages: '+rows.at(-1)!.text;
 const interAgent=e.messages.filter(m=>m.kind==='inter-agent').length;if(interAgent)link('inter-agent-messages','Agent chat',`${interAgent} retained`,'Messages','Activity');
 link('refs','Refs',`${session.refs?.length??'—'} targets · ${session.refCoverage??'retained'}`,'Refs','Activity');
 link('todo','To-do',`${['reported','empty'].includes(session.todoStatus??'')?session.todos?.filter(todo=>!todo.checked).length??0:'—'} pending · ${session.todoStatus??'not reported'}`,'To-do','Activity');
 const notebookKey=resolveNotesSessionKey(state),notebook=data.sessions.find(value=>value.key===notebookKey),notebookStatus=state.notes&&state.notes.sessionKey===notebookKey?(state.notes.persisted===false&&state.notes.status==='saved'?'Open editor':state.notes.status):'Open editor';
 link('notes','Notes',notebookStatus+(notebookKey!==session.key?' · '+sessionName(notebook):''),'Notes','Activity');
 rows.at(-1)!.help='Notes belong to '+sessionName(notebook)+', the owning agent for this panel. Inspecting workers does not switch its notebook. Notes survive updates and panel restarts. Enter opens the notebook; Enter there edits; Ctrl+S saves immediately; text also autosaves.';
 return rows;
}
