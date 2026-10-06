import {tabs} from './types.ts';
import type {DashboardData,UiState,UiAction,ScreenRow,RenderedScreen,SessionView} from './types.ts';
import type {Message} from '../model/types.ts';
import {sanitize,truncate,wrap,number,bytes,age,spark} from './text.ts';

export function createUiState():UiState{return {tab:'Overview',cursor:0,scroll:0,collapsed:new Set(),expanded:new Set(),filter:'',editingFilter:false,pin:false,subtree:false,ascii:false,monochrome:false,help:false,numberPrefix:'',numberTargets:new Map(),view:'lineage',pagedMessages:new Map(),messageReaders:new Map(),readers:new Map(),followMessages:true};}
export function showDetail(state:UiState,text:string):void {if(state.detail===undefined)state.detailReader={cursor:state.cursor,cursorId:state.cursorId,scroll:state.scroll};if(state.tab==='Messages'&&state.selectedKey){const reader=state.messageReaders.get(state.selectedKey)??{lastIds:[],following:false,newCount:0};reader.following=false;state.messageReaders.set(state.selectedKey,reader);}state.detail=text.slice(0,1024*1024);state.cursor=0;state.scroll=0;state.cursorId=undefined;}
export function closeDetail(state:UiState):void {state.detail=undefined;if(state.detailReader){Object.assign(state,state.detailReader);state.detailReader=undefined;}}
function retainMessages(state:UiState,key:string,messages:Message[]):void {const merged=[...new Map([...(state.pagedMessages.get(key)??[]),...messages].map(message=>[message.id,message])).values()].sort((a,b)=>(a.timestamp??0)-(b.timestamp??0));const anchor=state.messageReaders.get(key)?.anchorId;let bytes=merged.reduce((sum,m)=>sum+Buffer.byteLength(m.text),0);while(merged.length>1000||merged.length>1&&bytes>8*1024*1024){const at=anchor?merged.findIndex(m=>m.id===anchor):-1;const index=at>=0&&merged.length-1-at>at?merged.length-1:merged[0]?.id===anchor?1:0;bytes-=Buffer.byteLength(merged.splice(index,1)[0]!.text);}state.pagedMessages.delete(key);state.pagedMessages.set(key,merged);let total=[...state.pagedMessages.values()].reduce((sum,list)=>sum+list.reduce((size,m)=>size+Buffer.byteLength(m.text),0),0);for(const old of state.pagedMessages.keys())if(old!==key&&(state.pagedMessages.size>16||total>32*1024*1024)){total-=state.pagedMessages.get(old)!.reduce((sum,m)=>sum+Buffer.byteLength(m.text),0);state.pagedMessages.delete(old);}}
export function addMessagePage(state:UiState,key:string,messages:Message[]):void {retainMessages(state,key,messages);const reader=state.messageReaders.get(key);if(reader)reader.following=false;}
const allMessages=(session:SessionView,state:UiState)=>[...new Map([...(state.pagedMessages.get(session.key)??[]),...session.evidence.messages].map(message=>[message.id,message])).values()].sort((a,b)=>(a.timestamp??0)-(b.timestamp??0));
const duration=(value?:number)=>value===undefined||!Number.isFinite(value)?'—':`${number(value/1000)}s`;
const resident=(value?:string)=>{if(value!==undefined&&/^\d+$/.test(value)){const amount=BigInt(value);if(amount>0n&&amount<1048576n)return `${number(Number(amount)/1024)}KiB`;}return bytes(value);};
function historyValues(session:SessionView,kind:'cpu'|'memory',width:number,now:number):(number|undefined)[]{const values=(session.history?.[kind]??[]).map(value=>{if(value===undefined)return;try{const n=typeof value==='number'?value:Number(BigInt(value));return Number.isFinite(n)?n:undefined;}catch{return;}});const points=session.history?.points;if(points?.length&&session.history?.windowMs){const buckets:Array<number|undefined>=Array(width).fill(undefined);const gaps=new Set<number>();const from=now-session.history.windowMs;for(let i=0;i<points.length;i++){const index=Math.floor((points[i]!.at-from)*width/session.history.windowMs);if(index<0||index>=width)continue;if(points[i]!.gap||values[i]===undefined)gaps.add(index);else buckets[index]=Math.max(buckets[index]??0,values[i]!);}for(const index of gaps)buckets[index]=undefined;return buckets;}if(values.length<=width)return values;return Array.from({length:width},(_,i)=>{const bucket=values.slice(Math.floor(i*values.length/width),Math.floor((i+1)*values.length/width));return bucket.some(value=>value===undefined)?undefined:Math.max(...bucket as number[]);});}
function descendants(data:DashboardData,session:SessionView):SessionView[]{const nodes=new Map(data.sessions.map(s=>[s.key,s]));const visited=new Set([session.key]);const queue=[...session.children];const result:SessionView[]=[];for(let i=0;i<queue.length;i++){const key=queue[i]!;if(visited.has(key))continue;visited.add(key);const node=nodes.get(key);if(node){result.push(node);queue.push(...node.children);}}return result;}
function breadcrumb(data:DashboardData,session:SessionView):string {const nodes=new Map(data.sessions.map(s=>[s.key,s]));const path:string[]=[];const seen=new Set<string>();let node:SessionView|undefined=session;while(node&&!seen.has(node.key)){seen.add(node.key);path.push(node.evidence.title??node.evidence.id);node=node.parentKey?nodes.get(node.parentKey):undefined;}return path.reverse().join(' › ');}
const match=(text:string,state:UiState)=>!state.filter||sanitize(text).toLocaleLowerCase().includes(state.filter.toLocaleLowerCase());
const pathName=(value?:string)=>value?.replace(/[\\/]+$/,'').split(/[\\/]/).at(-1);
const checkoutBadge=(session:SessionView)=>`${pathName(session.git?.root??session.evidence.cwd)??'checkout unavailable'}@${session.git?.branch??session.git?.branchState??'branch unavailable'}`;
function overview(session:SessionView,state:UiState,columns:number,now:number,data:DashboardData):ScreenRow[]{
  const rows:ScreenRow[]=[];const add=(id:string,text:string,definition?:string)=>rows.push({id,text,...(definition?{action:{type:'message' as const,text:definition}}:{})});
  const resource=session.resource,usage=session.usage,evidence=session.evidence;
  if(data.server)add('server',`Server ${data.server.host}/${data.server.session}`,`Collecting server: ${data.server.host}\nHerdr session: ${data.server.session}\nAll displayed process, transcript and Git facts belong to this server. Saved-machine labels are assigned separately by the viewing client.`);
  const chartWidth=Math.max(3,columns-20);add('cpu',`CPU ${number(resource?.cpuPercent)}% ${spark(historyValues(session,'cpu',chartWidth,now),chartWidth,state.ascii)}`,'CPU: sampled user + kernel delta / monotonic elapsed; 100% = one logical core. First sample needs warmup. Scope includes verified owned processes only. History shows sampled bucket peaks; blanks are unavailable gaps and are never interpolated.');
  add('memory',`${resource?.memoryLabel==='working-set sum'?'WS sum':'RSS sum'} ${resident(resource?.memoryBytes)}  peak ${resident(session.history?.peakMemoryBytes)}`,'Resident-memory sum includes each process once but may count shared pages more than once. Windows uses working set. Peak is the highest observed aggregate sample, not a lifetime allocation figure.');
  add('memory-spark',`Memory history ${spark(historyValues(session,'memory',chartWidth,now),chartWidth,state.ascii)}`,'Memory history uses the same session/scope as the Processes table. Each column shows a sampled bucket peak; blank gaps are unavailable. The fixed window is supplied by the collector, never interpolated.');
  add('coverage',`${resource?.processes.length??0} processes · ${resource?.coverage?.readable??0}/${resource?.coverage?.total??0} readable`);
  if(resource?.sharedWith)add('shared',`Shared with ${resource.sharedWith}`);
  add('resource-age',`OS: ${resource?.availability??'unavailable'} · sample ${age(resource?.sampledAt,now)} ago`);
  add('tokens','Tokens · recorded usage','Provider counters are recorded observations. Cached tokens may be a subset of input or a separate category. Repeated cumulative snapshots are not added twice. Missing counters are unavailable.');
  add('input',`Input   ${number(usage?.input)}`);add('output',`Output  ${number(usage?.output)}`);
  add('cache',`Cache read ${number(usage?.cacheRead)} · write ${number(usage?.cacheWrite)}`);
  add('cache-kind',`Cache semantics: ${usage?.cacheSemantics??'unknown'}`);
  const turn=usage?.turnUsage;if(turn){const label=evidence.activeTurn?.id===turn.turnId?'Current turn':'Last recorded turn';const sources=evidence.usage.filter(record=>record.turnId===turn.turnId&&record.source).slice(-10).map(record=>record.source).join('\n');add('turn-tokens',`${label} ${turn.turnId}: in ${number(turn.input)} · out ${number(turn.output)} · total ${number(turn.total)}`,`${label}: ${turn.turnId}\nAvailability: ${turn.availability}\nCoverage: ${turn.coverage.usable}/${turn.coverage.total} usable observations\nSource: ${turn.source}\n${sources||'Record source not reported'}${turn.diagnostics.length?`\n${turn.diagnostics.join('\n')}`:''}`);add('turn-cache',`${label} cache read ${number(turn.cacheRead)} · write ${number(turn.cacheWrite)} · reasoning ${number(turn.reasoning)}`);add('turn-coverage',`${turn.availability} · ${turn.coverage.usable}/${turn.coverage.total} turn observations · ${turn.source}`);}else add('turn-tokens',`${evidence.activeTurn?.id?'Current turn':'Last recorded turn'} tokens unavailable`,'Per-turn counters require explicit provider turn IDs and compatible deltas or a prior-turn cumulative baseline. Initial lifetime counters do not establish a turn total.');
  add('context',`Context ${number(usage?.contextUsed)} / ${number(usage?.contextLimit)}${usage?.contextPercent===undefined?'':` (${number(usage.contextPercent)}%)`}`,'Context occupancy is distinct from lifetime tokens consumed. Percentage is available only with an actual current-context measurement and compatible known capacity.');
  if(usage?.generationTokensPerSecond!==undefined)add('rate',`Generation ${number(usage.generationTokensPerSecond)} tokens/s`);
  if(usage?.turnTokensPerSecond!==undefined)add('turn-rate',`Turn throughput ${number(usage.turnTokensPerSecond)} tokens/s`);
  if(usage?.cost)add('cost',`Cost ${usage.cost.currency} ${usage.cost.amount.toFixed(4)} (${usage.cost.availability})`);
  add('usage-age',`Provider: ${usage?.availability??'unavailable'} · since ${age(usage?.recordedSince,now)} ago`);
  const role=(value:string)=>evidence.messages.filter(m=>m.kind!=='inter-agent'&&m.role===value).length;
  add('messages',`Messages retained U${role('user')} A${role('assistant')} · tools ${evidence.tools.length}`,'These counts cover the retained transcript window, not the full lifetime. Historical messages can be loaded in Messages.');
  const interAgent=evidence.messages.filter(m=>m.kind==='inter-agent').length;if(interAgent)add('inter-agent-messages',`Agent messages retained: ${interAgent}`,'Messages between agents are separate from user/assistant chat. Their ACTION text does not establish requests to the user.');
  add('tools',`Tools retained: ${evidence.tools.filter(t=>t.status==='running').length} active · ${evidence.tools.filter(t=>t.status==='error').length} errors`);
  const children=descendants(data,session);add('children',`Descendant agents: ${children.length}`);const statuses=new Map<string,number>();for(const child of children){const status=child.evidence.state??'unknown';statuses.set(status,(statuses.get(status)??0)+1);}if(children.length)add('descendant-status',[...statuses].map(([status,count])=>`${status} ${count}`).join(' · '));
  const goal=evidence.goals.at(-1);add('goal',`Goal: ${goal?.objective??'not reported'}`,goal?`Goal: ${goal.objective}\nStatus: ${goal.status??'not reported'}\nSource: ${goal.source??'not reported'}\nReported: ${goal.timestamp!==undefined&&Number.isFinite(goal.timestamp)&&Math.abs(goal.timestamp)<=8640000000000000?new Date(goal.timestamp).toISOString():'not reported'}`:'No explicit goal has been reported. Initial requests and delegated tasks are separate.');
  if(evidence.task)add('task',`Task: ${evidence.task}`);
  const initial=evidence.initialRequest;if(initial)add('initial-request',`Initial request: ${initial.text}`,`Initial user request\nSource: ${initial.source??'not reported'}\nRecorded: ${age(initial.timestamp,now)} ago\n${initial.text}\nThis request does not establish an explicit current goal.`);else{add('initial-request','Initial request: unavailable (bounded prefix)');const retained=evidence.messages.find(message=>message.role==='user');if(retained)add('retained-request',`Earliest retained user request: ${retained.text}`,`User request · ${retained.source??'source not reported'}\n${retained.text}\nThis is the earliest retained user message, not a claimed original request or current goal.`);}
  add('timing',`Session ${age(evidence.startedAt,now)} · last activity ${age(evidence.lastActivity,now)}`);
  add('turn-duration',`Reported turn ${duration(usage?.turnMs)} · generation ${duration(usage?.generationMs)}`,'Turn duration includes tools, waits and thinking. Generation duration appears only when explicitly recorded. Silence and file modification time are not generation timers.');
  const harnesses=resource?.processes.filter(process=>process.isHarness&&process.owner===session.key&&process.availability!=='unavailable')??[];const uptime=harnesses.length===1?harnesses[0]?.uptimeMs:undefined;
  const active=evidence.activeTurn;const elapsed=active?.source&&Number.isFinite(active.startedAt)&&active.startedAt>=0&&active.startedAt<=8640000000000000&&active.startedAt<=now?now-active.startedAt:undefined;const turnDetail=elapsed!==undefined?`\nCurrent turn ${active!.id??'ID not reported'}\nStarted: ${new Date(active!.startedAt).toISOString()}\nSource: ${active!.source}`:'';
  add('process-uptime',`Harness uptime ${duration(uptime)} · current turn ${duration(elapsed)}`,'Harness uptime is a platform-specific measured process lifetime for the validated root process of this exact session. Owned child processes do not substitute for the harness. Current turn elapsed requires an explicit sourced active-turn boundary. These values are unavailable when that evidence is not supplied.'+turnDetail);
  add('todo',`To-do: ${session.todoStatus??'not reported'} · ${['reported','empty'].includes(session.todoStatus??'')?session.todos?.filter(t=>!t.checked).length??0:'—'} pending`);
  const git=session.git;
  add('git',`${git?.branch??git?.branchState??'Git unavailable'} +${number(git?.added)} -${number(git?.deleted)}`);
  if(git)add('git-details',`?${number(git.untrackedFiles)} conflicts ${number(git.conflicts)} ↑${number(git.ahead)} ↓${number(git.behind)} ${git.availability}`);
  if(evidence.reason)add('reason',evidence.reason);
  return rows;
}
function agentRows(data:DashboardData,state:UiState,numeric:Map<number,string>):ScreenRow[]{
  const rows:ScreenRow[]=[];const nodes=new Map(data.sessions.map(s=>[s.key,s]));let index=0;
  const hidden=(s:SessionView)=>{let key=s.parentKey;const seen=new Set<string>();while(key&&!seen.has(key)){seen.add(key);if(state.collapsed.has(key))return true;key=nodes.get(key)?.parentKey;}return false;};
  let sessions=data.sessions;
  if(state.view==='worktrees')sessions=[...sessions].sort((a,b)=>(a.git?.familyKey??'').localeCompare(b.git?.familyKey??'')||(a.git?.checkoutKey??a.evidence.cwd??'').localeCompare(b.git?.checkoutKey??b.evidence.cwd??''));
  let familyGroup='';let checkoutGroup='';
  for(const session of sessions){
    if(state.view==='lineage'&&hidden(session))continue;
    const title=`${session.evidence.provider} ${session.evidence.title??session.evidence.id} ${session.evidence.state??'unknown'}`;
    if(!match(title,state))continue;
    if(state.view==='worktrees'){const family=session.git?.familyKey;const familyKey=family??'unknown-family';if(familyKey!==familyGroup){rows.push({id:`family:${familyKey}`,text:family?`Repository ${family}`:'Repository family unavailable'});familyGroup=familyKey;checkoutGroup='';}const checkout=session.git?.checkoutKey??session.git?.root??session.evidence.cwd??'unknown-checkout';if(checkout!==checkoutGroup){rows.push({id:`checkout:${checkout}`,text:`  Checkout ${session.git?.root??session.evidence.cwd??'unavailable'} · ${session.git?.branch??session.git?.branchState??'branch unavailable'}`});checkoutGroup=checkout;}}
    const value=++index;numeric.set(value,session.key);
    const glyph=session.children.length?(state.collapsed.has(session.key)?(state.ascii?'+':'▸'):(state.ascii?'-':'▾')):(state.ascii?'·':'·');
    const depth=state.view==='lineage'?Math.min(session.depth,5):1;
    const live=session.attachment?'': ' · no pane';
    rows.push({id:session.key,text:`${' '.repeat(depth*2)}${glyph} [${value}] ${session.depth>5&&state.view==='lineage'?`d${session.depth} `:''}${title}${state.view==='lineage'?` [${checkoutBadge(session)}]`:''}${live}`,action:{type:'focus',sessionKey:session.key},disclosureColumn:session.children.length?depth*2+1:undefined});
    if(state.expanded.has(session.key)){
      rows.push({id:session.key+':goal',text:`  Goal: ${session.evidence.goals.at(-1)?.objective??'not reported'}`});
      rows.push({id:session.key+':branch',text:`  ${session.git?.branch??session.evidence.cwd??'Checkout unavailable'} · ${session.evidence.messages.length} messages`});
    }
  }
  return rows;
}
function contentRows(session:SessionView,state:UiState,columns:number,now:number,data:DashboardData):ScreenRow[]{
  const rows:ScreenRow[]=[];
  if(state.tab==='Overview')return overview(session,state,columns,now,data);
  if(state.tab==='Processes'){
    rows.push({id:'scope',text:`${session.resource?.memoryLabel??'Resident sum'} ${resident(session.resource?.memoryBytes)} · CPU ${number(session.resource?.cpuPercent)}%`});
    const processes=session.resource?.processes??[];const byPid=new Map(processes.map(p=>[p.pid,p]));const children=new Map<string,typeof processes>();const roots:typeof processes=[];
    for(const process of processes){const parent=byPid.get(process.ppid??-1);let valid=parent&&parent.key!==process.key;try{if(parent&&BigInt(parent.startTime)>BigInt(process.startTime))valid=false;}catch{valid=false;}if(valid){const list=children.get(parent!.key)??[];list.push(process);children.set(parent!.key,list);}else roots.push(process);}
    const seen=new Set<string>();const visit=(root:typeof processes[number])=>{const pending=[{process:root,depth:0}];while(pending.length){const {process,depth}=pending.pop()!;if(seen.has(process.key))continue;seen.add(process.key);const descendants=children.get(process.key)??[];const fold=`process:${session.key}:${process.key}`;const denied=process.availability==='unavailable';const memory=resident(denied?undefined:process.rssBytes);const cpu=number(denied?undefined:process.cpuPercent);
    const indent=Math.min(depth*2,Math.max(0,columns-16));
    if(match(process.name,state))rows.push({id:process.key,text:`${' '.repeat(indent)}${descendants.length?(state.collapsed.has(fold)?'▸':'▾'):'·'} ${process.pid} ${process.name} ${cpu}% ${memory}${denied?' (unavailable)':''}`,action:{type:'message',text:`Process ${process.name}\nPID ${process.pid} PPID ${process.ppid??'—'}\nBirth ${process.startTime}\nOwner ${process.owner}\nCPU ${cpu}%\nMemory ${memory}\nAvailability ${process.availability??'known'}\nThreads ${number(denied?undefined:process.threads)}\nIdentity ${process.key}\nThis dashboard is observational.`},disclosureColumn:descendants.length?indent+1:undefined});
    if(!state.collapsed.has(fold))for(const child of [...descendants].reverse())pending.push({process:child,depth:depth+1});else{const hidden=[...descendants];for(let i=0;i<hidden.length;i++){const child=hidden[i]!;if(seen.has(child.key))continue;seen.add(child.key);hidden.push(...children.get(child.key)??[]);}}}};
    for(const process of roots)visit(process);for(const process of processes)if(!seen.has(process.key))visit(process);
    if(session.resource?.reason)rows.push({id:'reason',text:session.resource.reason});
  }else if(state.tab==='Messages'){
    for(const message of allMessages(session,state)){if(!match(message.text,state))continue;const tools=message.tools??[];
      rows.push({id:message.id,text:`${message.kind==='inter-agent'?`Agent ${message.author??'unknown'} → ${message.recipient??'unknown'}`:message.role==='user'?'U':message.role==='tool'?'Tool result':'A'} · ${session.evidence.provider} · ${age(message.timestamp,now)} ago · ${tools.length} tools`,action:{type:'message',sessionKey:session.key,id:message.id,text:message.text},copy:message.text});
      const full=state.expanded.has(message.id);const lines=wrap(full?message.text.slice(0,128*1024):message.text.slice(0,Math.max(256,columns*12)),Math.max(1,columns-2),full?2000:3);const limit=lines.length;
      for(const [i,line]of lines.slice(0,Math.min(limit,2000)).entries())rows.push({id:`${message.id}:line:${i}`,text:`  ${line}`,action:{type:'message',sessionKey:session.key,id:message.id,text:message.text},copy:message.text});
      for(const tool of tools)rows.push({id:`${message.id}:tool:${tool.id}`,text:`  ${tool.status} ${tool.name}: ${tool.summary??''}`,action:{type:'message',text:`${tool.status} ${tool.name}\n${tool.summary??'No recorded result'}${tool.editedPaths?.length?`\nEdited paths: ${tool.editedPaths.join('\n')}`:''}`},copy:tool.summary??tool.name});
    }
  }else if(state.tab==='Refs'){
    const coverage=session.refCoverage;const label=coverage==='session'?'Session reference history':coverage==='partial'?'Partial reference history':coverage==='unavailable'?'Reference source unavailable':'Retained message references';
    rows.push({id:'refs-coverage',text:`${label} · ${session.refs?.length??0} retained · ${age(session.refUpdatedAt,now)} ago`});
    let group='';for(const ref of session.refs??[]){if(!match(ref.target,state))continue;if(ref.messageId!==group){rows.push({id:`source:${ref.messageId}`,text:`Message ${ref.messageId}`,action:{type:'source',sessionKey:session.key,id:ref.messageId}});group=ref.messageId;}
      rows.push({id:ref.id,text:`${ref.edited?'✎ ':''}${ref.exists===false?'? ':''}${ref.target}${ref.kind==='directory'?'/':''}${ref.line?`:${ref.line}`:''}`,action:{type:'open-ref',sessionKey:session.key,id:ref.id,target:ref.target,line:ref.line},sourceId:ref.messageId,copy:ref.target});}
  }else if(state.tab==='To-do'){
    rows.push({id:'todo-status',text:`${session.todoStatus??'not reported'} · ${['reported','empty'].includes(session.todoStatus??'')?session.todos?.filter(t=>!t.checked).length??0:'—'} pending · list ${age(session.todoReportedAt,now)} ago`,...(session.todoSourceMessageId?{action:{type:'source' as const,sessionKey:session.key,id:session.todoSourceMessageId},sourceId:session.todoSourceMessageId}:{})});
    for(const todo of [...session.todos??[]].sort((a,b)=>Number(a.checked)-Number(b.checked))){if(!match(todo.text,state))continue;const commands=[...todo.text.matchAll(/`([^`\n]+)`/g)];rows.push({id:todo.id,text:`[${todo.checked?'x':' '}] ${todo.text} · ${age(todo.firstSeenAt,now)} ago${todo.repeated?todo.checked?' · repeat · locally checked':' · repeated request':''}`,action:{type:'source',sessionKey:session.key,id:todo.messageId},sourceId:todo.messageId,copy:commands.length===1?commands[0]![1]:todo.text});}
  }
  return rows;
}
export function renderScreen(data:DashboardData,state:UiState,columns:number,height:number,now=Date.now()):RenderedScreen {
  columns=Math.max(1,Math.floor(columns));height=Math.max(1,Math.floor(height));const session=data.sessions.find(s=>s.key===state.selectedKey)??data.sessions[0];if(session&&!state.selectedKey)state.selectedKey=session.key;
  const numericTargets=new Map<number,string>();let rows:ScreenRow[]=[];
  const server=data.server?`${data.server.host}/${data.server.session} · `:'';
  const header=server+(session?`${data.demo?'[DEMO] ':''}${session.evidence.provider} · ${session.evidence.title??session.evidence.id} · ${session.evidence.model??session.usage?.model??'model unavailable'} ${state.pin?'[pin]':''}`:'Herdr Prism · no session');
  const readerKey=`${session?.key??''}:${state.tab}:${state.view}`;if(state.detail===undefined&&!state.help&&state.readerKey!==readerKey){if(state.readerKey)state.readers.set(state.readerKey,{cursor:state.cursor,cursorId:state.cursorId,scroll:state.scroll});const saved=state.readers.get(readerKey);if(saved)Object.assign(state,saved);else if(state.readerKey){state.cursor=0;state.cursorId=undefined;state.scroll=0;}state.readerKey=readerKey;while(state.readers.size>96)state.readers.delete(state.readers.keys().next().value!);}
  let followEnd=false;
  if(session&&state.tab==='Messages'){
    const reader=state.messageReaders.get(session.key)??{lastIds:[],following:state.followMessages,newCount:0};const ids=session.evidence.messages.map(m=>m.id);const previous=new Set(reader.lastIds);const added=reader.initialized?ids.filter(id=>!previous.has(id)).length:0;followEnd=reader.following&&(!reader.initialized||added>0);if(reader.following)reader.newCount=0;else reader.newCount+=added;reader.lastIds=ids.slice(-1000);reader.initialized=true;state.messageReaders.set(session.key,reader);while(state.messageReaders.size>16)state.messageReaders.delete(state.messageReaders.keys().next().value!);retainMessages(state,session.key,session.evidence.messages);
  }
  if(state.help)rows=wrap('Tab/Shift-Tab views; j/k or arrows move; Home/End; PageUp/PageDown; b older messages; Enter focus/open; Space fold/expand; d full details; / filter; Escape back; p pin; u subtree; w worktrees; s source; y copy (one inline command, otherwise full To-do request); x check/reopen To-do; e content-free diagnostic export; , settings; q close. Numbers + Enter select the displayed agent target. Data is source-labeled; — means unavailable, 0 means measured zero.',columns).map((text,i)=>({id:`help:${i}`,text}));
  else if(state.detail!==undefined)rows=wrap(state.detail,columns).map((text,i)=>({id:`detail:${i}`,text}));
  else if(state.tab==='Agents')rows=agentRows(data,state,numericTargets);
  else if(session)rows=contentRows(session,state,columns,now,data);
  if(!rows.length)rows.push({id:'empty',text:session?.evidence.availability==='unavailable'?'Data unavailable':'No recorded items'});
  if(followEnd&&state.detail===undefined&&!state.help){state.cursor=rows.length-1;state.cursorId=undefined;}
  if(state.cursorId){const at=rows.findIndex(r=>r.id===state.cursorId);if(at>=0)state.cursor=at;}
  state.cursor=Math.max(0,Math.min(state.cursor,rows.length-1));state.cursorId=rows[state.cursor]?.id;
  if(session&&state.tab==='Messages'&&state.detail===undefined&&!state.help){const reader=state.messageReaders.get(session.key)!;reader.anchorId=rows[state.cursor]?.action?.id;if(reader.following&&!followEnd&&state.cursor<rows.length-1)reader.following=false;}
  const bodyStart=3,bodyHeight=Math.max(1,height-5);
  if(state.cursor<state.scroll)state.scroll=state.cursor;if(state.cursor>=state.scroll+bodyHeight)state.scroll=state.cursor-bodyHeight+1;state.scroll=Math.max(0,Math.min(state.scroll,Math.max(0,rows.length-bodyHeight)));
  const scope=state.subtree?'Subtree':'Self + jobs';
  const lines=[header,`${session?.evidence.id??'—'} · ${session?.evidence.state??'unknown'} · ${scope}`,columns<65?`< ${state.tab} > ${state.editingFilter?'/'+state.filter:''}`:tabs.map(tab=>tab===state.tab?`[${tab}]`:tab).join(' ')];
  for(const row of rows.slice(state.scroll,state.scroll+bodyHeight))lines.push(row.text);
  while(lines.length<height-2)lines.push('');
  const messageReader=session&&state.tab==='Messages'?state.messageReaders.get(session.key):undefined;
  lines.push(state.notice??`${data.stale?'STALE · ':''}${messageReader?.newCount?`${messageReader.newCount} new · End follows · `:messageReader?.following?'Following end · ':''}OS/provider evidence · ${age(data.updatedAt,now)} ago`);
  lines.push(state.editingFilter?`Filter: ${state.filter}`:state.numberPrefix?`Agent index: ${state.numberPrefix} · Enter`:'Tab views · Enter open · ? help · q close');
  return {lines:lines.slice(0,height).map(line=>truncate(line,columns,state.ascii)),rows,selectedLine:bodyStart+state.cursor-state.scroll,bodyStart,bodyHeight,numericTargets};
}
export function handleRowClick(state:UiState,x:number,y:number,data:DashboardData,screen:RenderedScreen):UiAction|undefined {
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<1)return;
  const bodyRow=y-1-screen.bodyStart;
  if(bodyRow<0||bodyRow>=screen.bodyHeight)return;
  const index=bodyRow+state.scroll;
  if(index<0||index>=screen.rows.length)return;
  const row=screen.rows[index]!;state.cursor=index;state.cursorId=row.id;state.numberPrefix='';
  const tree=state.tab==='Agents'||state.tab==='Processes';
  return handleKey(state,(tree?x===row.disclosureColumn:x<=3)?'space':'enter',data,screen);
}
export function handleKey(state:UiState,key:string,data:DashboardData,screen:RenderedScreen):UiAction|undefined {
  if(state.editingFilter){if(key==='enter'||key==='escape'){state.editingFilter=false;state.cursor=0;state.cursorId=undefined;}else if(key==='backspace')state.filter=[...state.filter].slice(0,-1).join('');else if(key.length===1)state.filter+=key;return;}
  if(key==='escape'){state.help=false;closeDetail(state);state.numberPrefix='';state.notice=undefined;return;}
  if(key==='?'||key==='help'){state.help=!state.help;state.cursor=0;state.cursorId=undefined;return;}
  if(key==='q'||key==='ctrl+c')return {type:'quit'};
  if(key==='tab'||key==='shift+tab'){closeDetail(state);if(state.readerKey)state.readers.set(state.readerKey,{cursor:state.cursor,cursorId:state.cursorId,scroll:state.scroll});const i=tabs.indexOf(state.tab);state.tab=tabs[(i+(key==='tab'?1:tabs.length-1))%tabs.length];state.numberPrefix='';return;}
  if(key==='/'){state.editingFilter=true;if(state.selectedKey&&state.messageReaders.has(state.selectedKey))state.messageReaders.get(state.selectedKey)!.following=false;return;}
  if(key==='p'){state.pin=!state.pin;return {type:'pin'};}
  if(key==='u'){state.subtree=!state.subtree;return {type:'scope'};}
  if(key==='w'&&state.tab==='Agents'){state.view=state.view==='lineage'?'worktrees':'lineage';state.cursorId=undefined;state.cursor=0;return;}
  if(key===',')return {type:'settings'};
  if(key==='e')return {type:'export'};
  if(/^\d$/.test(key)&&state.tab==='Agents'){if(!state.numberPrefix)state.numberTargets=new Map(screen.numericTargets);state.numberPrefix=(state.numberPrefix+key).slice(0,8);return;}
  if(key==='enter'&&state.numberPrefix){const sessionKey=state.numberTargets.get(Number(state.numberPrefix));state.numberPrefix='';return sessionKey?{type:'focus',sessionKey}:undefined;}
  if((key==='b'||key==='pageup'&&state.cursor===0)&&state.tab==='Messages'&&state.detail===undefined){const session=data.sessions.find(s=>s.key===state.selectedKey);const beforeId=session?allMessages(session,state)[0]?.id:undefined;const reader=state.selectedKey?state.messageReaders.get(state.selectedKey):undefined;if(reader){reader.following=false;reader.anchorId=beforeId;}state.cursorId=beforeId;state.cursor=0;return {type:'page-messages',sessionKey:state.selectedKey,beforeId};}
  const moves:Record<string,number>={j:1,down:1,k:-1,up:-1,pagedown:screen.bodyHeight,pageup:-screen.bodyHeight};
  if(key in moves){state.cursor+=moves[key];state.cursorId=undefined;const reader=state.selectedKey?state.messageReaders.get(state.selectedKey):undefined;if(reader&&state.tab==='Messages'&&state.detail===undefined)reader.following=state.cursor>=screen.rows.length-1;if(reader?.following)reader.newCount=0;return;}
  if(key==='home'||key==='g'){state.cursor=0;state.cursorId=undefined;const reader=state.selectedKey?state.messageReaders.get(state.selectedKey):undefined;if(reader&&state.tab==='Messages')reader.following=false;return;}
  if(key==='end'||key==='G'){state.cursor=screen.rows.length-1;state.cursorId=undefined;const reader=state.selectedKey?state.messageReaders.get(state.selectedKey):undefined;if(reader&&state.tab==='Messages'&&state.detail===undefined){reader.following=true;reader.newCount=0;}return;}
  const row=screen.rows[state.cursor];if(!row)return;
  if(key==='space'){
    if(state.tab==='Agents'){const session=data.sessions.find(s=>s.key===row.action?.sessionKey);if(session?.children.length){state.collapsed.has(session.key)?state.collapsed.delete(session.key):state.collapsed.add(session.key);}else if(session){state.expanded.has(session.key)?state.expanded.delete(session.key):state.expanded.add(session.key);}}
    else if(state.tab==='Messages'){const id=row.action?.id??row.id;state.expanded.has(id)?state.expanded.delete(id):state.expanded.add(id);}
    else if(state.tab==='Processes'){const id=`process:${state.selectedKey}:${row.id}`;state.collapsed.has(id)?state.collapsed.delete(id):state.collapsed.add(id);}
    else if(state.tab==='Refs')showDetail(state,row.copy??row.text);
    return;
  }
  if(key==='x'&&state.tab==='To-do')return {type:'toggle-todo',sessionKey:state.selectedKey,id:row.id};
  if(key==='y')return {type:'copy',text:row.copy??row.text};
  if(key==='s'&&row.sourceId)return {type:'source',sessionKey:state.selectedKey,id:row.sourceId};
  if(key==='d'&&state.tab==='Agents'){const session=data.sessions.find(s=>s.key===row.action?.sessionKey);if(session)return {type:'message',sessionKey:session.key,text:`${breadcrumb(data,session)}\nDepth ${session.depth}\n${session.evidence.provider} · ${session.evidence.state??'unknown'}\nParent: ${session.evidence.parentId?`${session.evidence.parentProvider??session.evidence.provider}:${session.evidence.parentId}`:'not reported'}\nParent source: ${session.evidence.parentSource??'not reported'}\nGoal: ${session.evidence.goals.at(-1)?.objective??'not reported'}\nTask: ${session.evidence.task??'not reported'}\nRepository family: ${session.git?.familyKey??'unavailable'}\nCheckout: ${session.git?.root??session.evidence.cwd??'unavailable'}\nBranch: ${session.git?.branch??session.git?.branchState??'unavailable'}`};}
  if(key==='enter'||key==='d')return row.action;
}
