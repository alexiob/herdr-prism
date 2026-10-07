import {inspectionParentKey} from '../runtime/follow.ts';
import {agentRows} from './agents.ts';
import {renderNotes} from './notes.ts';
import {orderedTabs} from './types.ts';
import type {DashboardData,UiState,UiAction,ScreenRow,RenderedScreen,SessionView,DetailDocument} from './types.ts';
import type {Message} from '../model/types.ts';
import {sanitize,truncate,wrap,number,bytes,age,spark} from './text.ts';
import {visibleReferences} from './reference-readers.ts';
import {overviewRows,processDocument,referenceDocument,gitDocument,identityDocument,rowHelp,resourceDocument,factRow} from './facts.ts';
import {renderLayout,groupRows,sectionReaderKey} from './layout.ts';
import type {LayoutSection} from './layout.ts';
import {documentText,summary} from './widgets.ts';
export {addReferencePage,showReferenceSources} from './reference-readers.ts';

export function createUiState():UiState{return {tab:'Overview',cursor:0,scroll:0,collapsed:new Set(),expanded:new Set(),filter:'',editingFilter:false,pin:false,subtree:false,ascii:false,monochrome:false,help:false,numberPrefix:'',numberTargets:new Map(),view:'lineage',pagedMessages:new Map(),messageReaders:new Map(),readers:new Map(),followMessages:true,pagedRefs:new Map()};}
export function showDetail(state:UiState,text:string,document?:DetailDocument):void {const position={cursor:state.cursor,cursorId:state.cursorId,scroll:state.scroll,detailViewId:state.detailViewId};if(state.detail!==undefined)(state.detailStack??=[]).push({text:state.detail,document:state.detailDocument,position});else if(state.refSources)state.sourceDetailReader=position;else state.detailReader=position;if(state.tab==='Messages'&&state.selectedKey){const reader=state.messageReaders.get(state.selectedKey)??{lastIds:[],following:false,newCount:0};reader.following=false;state.messageReaders.set(state.selectedKey,reader);}state.readerSequence=(state.readerSequence??0)+1;state.detailViewId=state.readerSequence;state.detail=text.slice(0,1024*1024);state.detailDocument=document;state.cursor=0;state.scroll=0;state.cursorId=undefined;}
export function closeDetail(state:UiState):void {const prior=state.detailStack?.pop();if(state.detail!==undefined&&prior){state.detail=prior.text;state.detailDocument=prior.document;Object.assign(state,prior.position);return;}if(state.detail!==undefined&&state.refSources){state.detail=undefined;state.detailDocument=undefined;if(state.sourceDetailReader)Object.assign(state,state.sourceDetailReader);state.sourceDetailReader=undefined;return;}if(state.refSources&&state.refParent){state.detail=state.refParent.text;state.detailDocument=state.refParent.document;Object.assign(state,state.refParent.position);state.refParent=undefined;state.refSources=undefined;return;}state.detail=undefined;state.detailDocument=undefined;state.refSources=undefined;state.sourceDetailReader=undefined;if(state.detailReader){Object.assign(state,state.detailReader);state.detailReader=undefined;}}
function closeHelp(state:UiState):void {state.help=false;state.helpText=undefined;if(state.helpReader)Object.assign(state,state.helpReader);state.helpReader=undefined;}
export function changeTab(state:UiState,tab:import('./types.ts').Tab):UiAction {closeHelp(state);while(state.detail!==undefined||state.refSources)closeDetail(state);if(state.readerKey)state.readers.set(state.readerKey,{cursor:state.cursor,cursorId:state.cursorId,scroll:state.scroll});state.tab=tab;state.numberPrefix='';return {type:'tab',tab};}
function retainMessages(state:UiState,key:string,messages:Message[]):void {const merged=[...new Map([...(state.pagedMessages.get(key)??[]),...messages].map(message=>[message.id,message])).values()].sort((a,b)=>(a.timestamp??0)-(b.timestamp??0));const anchor=state.messageReaders.get(key)?.anchorId;let bytes=merged.reduce((sum,m)=>sum+Buffer.byteLength(m.text),0);while(merged.length>1000||merged.length>1&&bytes>8*1024*1024){const at=anchor?merged.findIndex(m=>m.id===anchor):-1;const index=at>=0&&merged.length-1-at>at?merged.length-1:merged[0]?.id===anchor?1:0;bytes-=Buffer.byteLength(merged.splice(index,1)[0]!.text);}state.pagedMessages.delete(key);state.pagedMessages.set(key,merged);let total=[...state.pagedMessages.values()].reduce((sum,list)=>sum+list.reduce((size,m)=>size+Buffer.byteLength(m.text),0),0);for(const old of state.pagedMessages.keys())if(old!==key&&(state.pagedMessages.size>16||total>32*1024*1024)){total-=state.pagedMessages.get(old)!.reduce((sum,m)=>sum+Buffer.byteLength(m.text),0);state.pagedMessages.delete(old);}}
export function addMessagePage(state:UiState,key:string,messages:Message[]):void {retainMessages(state,key,messages);const reader=state.messageReaders.get(key);if(reader)reader.following=false;}
const allMessages=(session:SessionView,state:UiState)=>[...new Map([...(state.pagedMessages.get(session.key)??[]),...session.evidence.messages].map(message=>[message.id,message])).values()].sort((a,b)=>(a.timestamp??0)-(b.timestamp??0));
const resident=(value?:string)=>{if(value!==undefined&&/^\d+$/.test(value)){const amount=BigInt(value);if(amount>0n&&amount<1048576n)return `${number(Number(amount)/1024)}KiB`;}return bytes(value);};
const match=(text:string,state:UiState)=>!state.filter||sanitize(text).toLocaleLowerCase().includes(state.filter.toLocaleLowerCase());
function overview(session:SessionView,state:UiState,columns:number,now:number,data:DashboardData):ScreenRow[]{return overviewRows(session,state,now,data);}

function contentRows(session:SessionView,state:UiState,columns:number,now:number,data:DashboardData):ScreenRow[]{
  const rows:ScreenRow[]=[];
  if(state.tab==='Overview')return overview(session,state,columns,now,data);
  if(state.tab==='Processes'){
    rows.push(factRow('scope','Coverage',`${session.resource?.coverage?.readable??'—'}/${session.resource?.coverage?.total??'—'} readable`,resourceDocument(session,'scope',state,now),rowHelp.coverage!,'Scope')); 
    const processes=session.resource?.processes??[];const byPid=new Map(processes.map(p=>[p.pid,p]));const children=new Map<string,typeof processes>();const roots:typeof processes=[];
    for(const process of processes){const parent=byPid.get(process.ppid??-1);let valid=parent&&parent.key!==process.key;try{if(parent&&BigInt(parent.startTime)>BigInt(process.startTime))valid=false;}catch{valid=false;}if(valid){const list=children.get(parent!.key)??[];list.push(process);children.set(parent!.key,list);}else roots.push(process);}
    const seen=new Set<string>();const visit=(root:typeof processes[number])=>{const pending=[{process:root,depth:0}];while(pending.length){const {process,depth}=pending.pop()!;if(seen.has(process.key))continue;seen.add(process.key);const descendants=children.get(process.key)??[];const fold=`process:${session.key}:${process.key}`;const denied=process.availability==='unavailable';const memory=resident(denied?undefined:process.rssBytes);const cpu=number(denied?undefined:process.cpuPercent);
    const cpuLabel=denied||process.cpuPercent===undefined?'—':number(process.cpuPercent)+'%';const shortMemory=memory.replace(/GiB$/,'G').replace(/MiB$/,'M').replace(/KiB$/,'K');const fixed=String(process.pid).length+cpuLabel.length+shortMemory.length+5;const available=Math.max(1,columns-6);const indent=Math.min(depth*2,Math.max(0,available-fixed-4));const nameWidth=Math.max(1,available-fixed-indent);
    if(match(process.name,state)){const document=processDocument(session,process,now);rows.push({id:process.key,section:'Owned processes',text:`${' '.repeat(indent)}${descendants.length?(state.collapsed.has(fold)?'▸':'▾'):'·'} ${process.pid} ${summary(process.name,nameWidth)} ${cpuLabel} ${shortMemory}`,help:'Enter opens complete identity, measurements, ownership and availability. Shift+K asks to terminate this exact process, with Cancel selected initially. Space folds owned process children. CPU 100% means one logical core. K/M/G use binary resident-memory units.',document,action:{type:'message',text:documentText(document),document},disclosureColumn:descendants.length?indent+1:undefined});}
    if(!state.collapsed.has(fold))for(const child of [...descendants].reverse())pending.push({process:child,depth:depth+1});else{const hidden=[...descendants];for(let i=0;i<hidden.length;i++){const child=hidden[i]!;if(seen.has(child.key))continue;seen.add(child.key);hidden.push(...children.get(child.key)??[]);}}}};
    for(const process of roots)visit(process);for(const process of processes)if(!seen.has(process.key))visit(process);
    if(session.resource?.reason)rows.push({id:'reason',text:session.resource.reason});
  }else if(state.tab==='Messages'){
    for(const [index,message]of allMessages(session,state).entries()){if(!match(message.text,state))continue;const tools=message.tools??[],block={section:'Retained messages',messageBand:index%2 as 0|1,sourceId:message.id};
      const help='Enter opens the full message; s opens its exact source; Space expands its preview; y copies the full text. Left/right switches between messages and tools; arrows, Home/End and Page Up/Down scroll the active panel. Mouse wheels scroll the hovered panel. Alternating backgrounds group each message header and body; the selected-row marker and highlight identify the current entry. b loads older message history.';
      rows.push({...block,id:message.id,role:'identity',help,text:`${message.kind==='inter-agent'?`Agent ${message.author??'unknown'} → ${message.recipient??'unknown'}`:message.role==='user'?'U':message.role==='tool'?'Tool result':'A'} · ${session.evidence.provider} · ${age(message.timestamp,now)} ago · ${tools.length} tools`,action:{type:'message',sessionKey:session.key,id:message.id,text:message.text},copy:message.text});
      const full=state.expanded.has(message.id);const lines=wrap(full?message.text.slice(0,128*1024):message.text.slice(0,Math.max(256,columns*12)),Math.max(1,columns-8),full?2000:3);const limit=lines.length;
      rows.at(-1)!.continuations=lines.slice(0,Math.min(limit,2000)).map(line=>({text:`  ${line}`,role:'text'}));
      for(const tool of tools)rows.push({...block,sourceId:message.id,id:`${message.id}:tool:${tool.id}`,role:'secondary',help:'Enter opens this recorded tool result; s opens its source message. Left/right switches panels; each panel scrolls independently.',text:`  ${tool.status} ${tool.name}: ${tool.summary??''}`,action:{type:'message',text:`${tool.status} ${tool.name}\n${tool.summary??'No recorded result'}${tool.editedPaths?.length?`\nEdited paths: ${tool.editedPaths.join('\n')}`:''}`},copy:tool.summary??tool.name});
    }
    const attached=new Set(allMessages(session,state).flatMap(message=>(message.tools??[]).map(tool=>tool.id)));
    for(const tool of session.evidence.tools.filter(tool=>!attached.has(tool.id))){const text=`${tool.status} ${tool.name}\n${tool.summary??'No recorded result'}${tool.editedPaths?.length?'\nEdited paths:\n'+tool.editedPaths.join('\n'):''}`;if(!match(text,state))continue;rows.push({id:'tool:'+tool.id,section:'Tool activity',text:`${tool.status} · ${tool.name} · ${tool.summary??'No recorded result'}`,help:'Enter opens the complete recorded tool result and edited paths. These are provider records, not inferred process activity. Left/right switches panels; arrows and the mouse wheel scroll only the active or hovered panel.',action:{type:'message',text},copy:text});}
  }else if(state.tab==='Refs'){
    const coverage=session.refCoverage;const label=coverage==='session'?'Session reference history':coverage==='partial'?'Partial reference history':coverage==='unavailable'?'Reference source unavailable':'Retained message references';
    rows.push({id:'refs-coverage',text:`${label} · ${session.refs?.length??0} retained · ${age(session.refUpdatedAt,now)} ago`});
    const references=visibleReferences(session,state),paged=state.pagedRefs.get(session.key);if(paged)rows.push({id:'refs-snapshot',text:`${paged.refs.length} loaded · snapshot${paged.stale?' · stale; b reloads':''} · ${age(paged.observedAt,now)} ago`});
    let group='';for(const ref of references){if(!match(ref.target,state))continue;const sourceGroup=ref.messageId+(ref.cursor?':'+ref.cursor.hash:'');if(sourceGroup!==group){rows.push({id:`source:${sourceGroup}`,text:`Message ${ref.messageId}`,action:{type:'source',sessionKey:session.key,id:ref.messageId,referenceCursor:ref.cursor}});group=sourceGroup;}
      rows.push({id:ref.id,text:`${ref.edited?'✎ ':''}${ref.exists===false?'? ':''}${ref.target.split(/[\\/]/).at(-1)}${ref.kind==='directory'?'/':''}${ref.line?`:${ref.line}`:''} · ${ref.target.split(/[\\/]/).slice(0,-1).join('/')}`,document:referenceDocument(session,ref,now),help:'Enter opens full target details; Space loads mentions; s opens the exact source; y copies the full path.',action:{type:'message',document:referenceDocument(session,ref,now),text:ref.target,referenceCursor:ref.cursor},sourceId:ref.messageId,copy:ref.target});}
    rows.push({id:'refs-page',text:paged&&!paged.hasMore&&!paged.stale?'End of target history · B reloads':'Load older reference targets · b',action:paged&&!paged.hasMore&&!paged.stale?undefined:{type:'page-refs',sessionKey:session.key,referencePageCursor:paged?.stale?undefined:paged?.cursor,restart:paged?.stale}});
  }else if(state.tab==='To-do'){
    rows.push({id:'todo-status',help:rowHelp.todo,text:`${session.todoStatus??'not reported'} · ${['reported','empty'].includes(session.todoStatus??'')?session.todos?.filter(t=>!t.checked).length??0:'—'} pending · list ${age(session.todoReportedAt,now)} ago`,...(session.todoSourceMessageId?{action:{type:'source' as const,sessionKey:session.key,id:session.todoSourceMessageId},sourceId:session.todoSourceMessageId}:{})});
    for(const todo of [...session.todos??[]].sort((a,b)=>Number(a.checked)-Number(b.checked))){if(!match(todo.text,state))continue;const commands=[...todo.text.matchAll(/`([^`\n]+)`/g)];rows.push({id:todo.id,text:`[${todo.checked?'x':' '}] ${todo.text} · ${age(todo.firstSeenAt,now)} ago${todo.repeated?todo.checked?' · repeat · locally checked':' · repeated request':''}`,help:'Enter opens this complete request and provenance.\n\n'+rowHelp.todo,action:{type:'message',text:todo.text,document:{help:rowHelp.todo,title:'Reported request',capturedAt:now,sections:[{id:'request',title:'Request',text:todo.text},{id:'source',title:'Recorded facts',column:1,fields:[{label:'First source',value:todo.messageId,role:'identity'},{label:'Latest source',value:todo.latestMessageId??todo.messageId,role:'identity'},{label:'First seen',value:age(todo.firstSeenAt,now),role:'duration'},{label:'Repeated',value:todo.repeated?'Yes':'No'},{label:'Locally checked',value:todo.checked?'Yes':'No',role:todo.checked?'positive':'text'}]}]}},sourceId:todo.messageId,copy:commands.length===1?commands[0]![1]:todo.text});}
  }
  if(state.tab==='Git'){
    const doc=gitDocument(session,now);
    for(const part of doc.sections)for(const [index,field]of (part.fields??[]).entries())rows.push(factRow(`git:${part.id}:${index}`,field.label,field.value,doc,rowHelp.git!,part.title,part.column,field.role));
  }
  if(state.tab==='Notes')rows.push({id:'notes-edit',text:state.notes?.status==='loading'?'Loading notes…':'Edit Markdown notes',help:rowHelp.notes,action:{type:'notes-edit',sessionKey:session.key}});
  return rows;
}
export function renderScreen(data:DashboardData,state:UiState,columns:number,height:number,now=Date.now()):RenderedScreen {
  if(data.tabOrder)state.tabOrder=[...data.tabOrder];
  columns=Math.max(1,Math.floor(columns));height=Math.max(1,Math.floor(height));const session=data.sessions.find(s=>s.key===state.selectedKey)??(!state.restrictAutomaticSelection?data.sessions[0]:undefined);if(session&&!state.selectedKey)state.selectedKey=session.key;
  if(state.refSources&&state.refSources.sessionKey!==session?.key){state.detail=undefined;closeDetail(state);}if(state.refSources&&state.refSources.revision!==session?.evidence.contentRevision)state.refSources.stale=true;
  const numericTargets=new Map<number,string>();let rows:ScreenRow[]=[];
  const server=data.server?`${data.server.host}/${data.server.session} · `:'';
  const header=server+(session?`${data.demo?'[DEMO] ':''}${session.evidence.provider} · ${session.evidence.title??session.evidence.id} · ${session.evidence.model??session.usage?.model??'model unavailable'} ${state.pin?'[pin]':''}`:'Herdr Prism · no session');
  const readerKey=`${session?.key??''}:${state.tab}:${state.view}`;if(state.detail===undefined&&!state.help&&state.readerKey!==readerKey){if(state.readerKey)state.readers.set(state.readerKey,{cursor:state.cursor,cursorId:state.cursorId,scroll:state.scroll});const saved=state.readers.get(readerKey);if(saved)Object.assign(state,saved);else if(state.readerKey){state.cursor=0;state.cursorId=undefined;state.scroll=0;}state.readerKey=readerKey;while(state.readers.size>96)state.readers.delete(state.readers.keys().next().value!);}
  if(state.tab==='Notes'&&!state.help&&state.detail===undefined)return renderNotes(data,state,columns,height,now);
  let followEnd=false;
  if(session&&state.tab==='Messages'){
    const reader=state.messageReaders.get(session.key)??{lastIds:[],following:state.followMessages,newCount:0};const ids=session.evidence.messages.map(m=>m.id);const previous=new Set(reader.lastIds);const added=reader.initialized?ids.filter(id=>!previous.has(id)).length:0;followEnd=reader.following&&(!reader.initialized||added>0);if(reader.following)reader.newCount=0;else reader.newCount+=added;reader.lastIds=ids.slice(-1000);reader.initialized=true;state.messageReaders.set(session.key,reader);while(state.messageReaders.size>16)state.messageReaders.delete(state.messageReaders.keys().next().value!);retainMessages(state,session.key,session.evidence.messages);
  }
  let document:DetailDocument|undefined;
  if(state.help)document={title:'Entry help',sections:[{id:'help',title:'Selected entry',text:state.helpText??'Tab/Shift-Tab views; arrows select; Enter opens content; ? explains an entry; Escape returns; q closes.'}]};
  else if(state.detail!==undefined)document=state.detailDocument??{title:'Full content',sections:[{id:'content',title:'Full content',text:state.detail}]};
  else if(state.refSources){const reader=state.refSources;rows=wrap(reader.reference.target+(reader.reference.line?':'+reader.reference.line:''),columns,128).map((text,i)=>({id:`ref-path:${i}`,text}));rows.push({id:'ref-sources-status',text:`${reader.sources.length} mention sources${reader.partial?' · partial input':''}${reader.stale?' · stale snapshot; b reloads':''} · ${age(reader.observedAt,now)} ago`});for(const source of reader.sources)rows.push({id:`ref-source:${source.messageId}:${source.cursor?.hash??source.source??''}`,text:`Message ${source.messageId} · ${age(source.timestamp,now)} ago${source.edited?' · edited':''}`,action:{type:'source',sessionKey:reader.sessionKey,id:source.messageId,referenceCursor:source.cursor},sourceId:source.messageId,copy:source.source??source.messageId});rows.push({id:'ref-sources-page',text:reader.hasMore||reader.stale?'Load older mentions · b':'End of mention history · B reloads',action:reader.hasMore||reader.stale?{type:'ref-sources',sessionKey:reader.sessionKey,id:reader.reference.id,referencePageCursor:reader.stale?undefined:reader.cursor,restart:reader.stale}:undefined});}
  else if(state.tab==='Agents')rows=agentRows(data,state,numericTargets,columns);
  else if(session)rows=contentRows(session,state,columns,now,data);
  if(!rows.length&&!document)rows.push({id:'empty',section:state.tab==='Messages'?'Retained messages':undefined,text:session?.evidence.availability==='unavailable'?'Data unavailable':'No recorded items',selectable:false,help:'No recorded entries are available for this session and view.'});
  for(const row of rows){row.help??=row.action?.type==='source'?'Enter opens this exact source message. Historical file/offset/hash cursors are preserved.':row.action?.type==='page-refs'?'Enter or b loads older targets; B reloads the history.':row.action?.type==='message'?'Enter opens the entire recorded content. ? explains the selected entry; Escape returns.':row.action?.type==='select'?'Enter inspects inside Prism; f explicitly focuses a live Herdr pane.':'Recorded view context. ? explains this entry; selectable actions carry a right arrow.';if(!row.action&&row.selectable!==false)row.action={type:'message',text:row.copy??row.text};}
  const anchoredSection=rows.find(row=>row.id===state.cursorId)?.section??rows[state.cursor]?.section;
  const lastMessageRow=rows.reduce((last,row,i)=>row.section==='Retained messages'?i:last,-1);
  if(followEnd&&!document&&anchoredSection!=='Tool activity'){state.cursor=lastMessageRow;state.cursorId=undefined;}
  const logical=document?document.sections.flatMap(section=>section.rows??[]):rows;
  if(!document&&state.cursorId){const at=logical.findIndex(r=>r.id===state.cursorId);if(at>=0)state.cursor=at;}
  if(!document&&logical.length){state.cursor=Math.max(0,Math.min(state.cursor,logical.length-1));state.cursorId=logical[state.cursor]?.id;}
  if(session&&state.tab==='Messages'&&!document){const reader=state.messageReaders.get(session.key)!;if(rows[state.cursor]?.section==='Retained messages'){reader.anchorId=rows[state.cursor]?.sourceId??rows[state.cursor]?.action?.id;if(reader.following&&!followEnd&&state.cursor<lastMessageRow)reader.following=false;}}
  const sections:LayoutSection[]=document?document.sections.map(section=>({...section,rows:section.rows??[]})):state.tab==='Messages'?['Retained messages','Tool activity'].map(id=>({id,title:id,rows:rows.filter(row=>row.section===id),viewport:true})):groupRows(rows,state.refSources?'Mention sources':state.tab==='Agents'?'Agent tree':state.tab);
  if(state.tab==='Processes'&&!document){const table=sections.find(section=>section.id==='Owned processes');if(table)table.description=['PID · name · CPU · RSS/WS'];}
  const result=renderLayout(data,state,sections,columns,height,now,numericTargets,document,state.tab==='Messages'&&!document||document?.processTarget?6:1);
  state.cursorId=result.rows[state.cursor]?.id;
  return result;
}

export function handleRowClick(state:UiState,x:number,y:number,data:DashboardData,screen:RenderedScreen):UiAction|undefined {
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<1)return;
  const navigation=screen.navigationRegions?.find(region=>region.y===y&&x>=region.x&&x<region.x+region.width);if(navigation)return state.processConfirmation?undefined:navigation.action;
  const tab=screen.tabRegions?.find(region=>region.y===y&&x>=region.x&&x<region.x+region.width);if(tab)return state.processConfirmation?undefined:changeTab(state,tab.tab);
  const region=screen.rowRegions?.find(region=>region.y===y&&x>=region.x-1&&x<region.x+region.width);if(!region)return;
  const row=screen.rows[region.index];if(!row)return;const changed=state.cursor!==region.index;state.cursor=region.index;state.cursorId=row.id;state.numberPrefix='';
  if(changed)resetEntryScroll(state,screen);
  if(row.selectable===false)return;
  return x===region.disclosureX?handleKey(state,'space',data,screen):x===region.actionX?handleKey(state,'enter',data,screen):undefined;
}

function resetEntryScroll(state:UiState,screen:RenderedScreen){const region=screen.sectionRegions?.find(region=>region.indices.includes(state.cursor));if(region){const reader=state.sectionReaders?.get(sectionReaderKey(state,region.id));if(reader)reader.freeScroll=false;}}
function scrollRegion(state:UiState,region:NonNullable<RenderedScreen['sectionRegions']>[number],delta:number,screen:RenderedScreen){
 const readers=state.sectionReaders??=new Map(),key=sectionReaderKey(state,region.id),reader=readers.get(key)??{cursor:region.indices[0]??0,scroll:0};
 const scroll=Math.max(0,Math.min(reader.scroll+delta,Math.max(0,region.total-Math.max(1,region.contentHeight))));
 const visible=region.lineIndices.slice(scroll,scroll+Math.max(1,region.contentHeight)).filter(index=>index>=0);
 if(!visible.includes(state.cursor))state.cursor=visible[0]??region.indices[0]??state.cursor;
 state.cursorId=screen.rows[state.cursor]?.id;reader.cursor=state.cursor;reader.cursorId=state.cursorId;reader.scroll=scroll;reader.freeScroll=true;readers.set(key,reader);state.scroll=scroll;
 if(region.id==='Retained messages'){const messages=state.messageReaders.get(state.selectedKey??'');if(messages){messages.following=scroll>=region.total-region.contentHeight&&delta>0;if(messages.following)messages.newCount=0;}}
}
/** Wheels move a panel's content lines; arrow keys move whole logical entries. */
export function handleRowWheel(state:UiState,x:number,y:number,delta:number,screen:RenderedScreen):boolean{
  if(state.tab==='Notes'&&!state.help&&state.detail===undefined){const region=screen.sectionRegions?.find(region=>x>=region.x&&x<region.x+region.width&&y>=region.y&&y<region.y+region.height);if(region){state.notesScroll=Math.max(0,Math.min((state.notesScroll??0)+delta,Math.max(0,region.total-region.contentHeight)));state.notesFreeScroll=state.notes?.editing===true;}return true;}
  if(!screen.sectionRegions)return false;
  const region=screen.sectionRegions.find(region=>x>=region.x&&x<region.x+region.width&&y>=region.y&&y<region.y+region.height);
  if(region?.indices.length)scrollRegion(state,region,delta,screen);
  return true;
}

export function handleKey(state:UiState,key:string,data:DashboardData,screen:RenderedScreen):UiAction|undefined {
  if(state.processConfirmation){
    if(state.help){if(key==='escape'||key==='?'||key==='help')closeHelp(state);else if(['up','k','down','j','home','end','pageup','pagedown'].includes(key)){resetEntryScroll(state,screen);state.cursor+=key==='up'||key==='k'?-1:key==='home'?-state.cursor:key==='end'?screen.rows.length:key==='pageup'?-screen.bodyHeight:key==='pagedown'?screen.bodyHeight:1;state.cursorId=undefined;}return;}
    if(key==='escape'||key==='n'||key==='q'||key==='ctrl+c'){state.processConfirmation=undefined;closeDetail(state);return;}
    if(key==='?'||key==='help'){state.helpReader={cursor:state.cursor,cursorId:state.cursorId,scroll:state.scroll};state.helpText=screen.rows[state.cursor]?.help??'Confirm only the captured process. Escape cancels. No signal is sent until you confirm.';state.readerSequence=(state.readerSequence??0)+1;state.helpViewId=state.readerSequence;state.help=true;state.cursor=0;state.cursorId=undefined;state.scroll=0;return;}
    if(key==='enter'&&screen.rows[state.cursor]?.id==='process-cancel'){state.processConfirmation=undefined;closeDetail(state);return;}
    if(key==='y'||key==='enter'&&screen.rows[state.cursor]?.id==='process-confirm'){
      const visible=screen.rowRegions?.find(r=>screen.rows[r.index]?.id==='process-confirm');
      if(!visible||visible.width<24||screen.bodyHeight<4){state.notice='Enlarge the pane to review and confirm termination';return;}
      const captured=state.processConfirmation;state.processConfirmation=undefined;closeDetail(state);return{type:'terminate-process',sessionKey:captured.sessionKey,processTarget:captured.target};
    }
    const moves:Record<string,number>={up:-1,k:-1,down:1,j:1,pageup:-screen.bodyHeight,pagedown:screen.bodyHeight};
    if(key in moves){state.cursor+=moves[key]!;state.cursorId=undefined;}else if(key==='home'||key==='end'){state.cursor=key==='home'?0:screen.rows.length-1;state.cursorId=undefined;}return;
  }
  if(key==='F'&&state.boundSessionKey&&!state.help&&!state.editingFilter&&!state.notes?.editing)return{type:'follow-bound',sessionKey:state.boundSessionKey};
  if(key==='r'&&!state.help&&!state.editingFilter&&!state.notes?.editing&&state.detailDocument?.processTarget)return{type:'process-output',sessionKey:state.selectedKey,processTarget:state.detailDocument.processTarget};
  if(key==='K'&&!state.help&&!state.editingFilter&&!state.notes?.editing){
    const target=state.detail!==undefined?state.detailDocument?.processTarget:state.tab==='Processes'?screen.rows[state.cursor]?.document?.processTarget:undefined;
    if(!target||!state.selectedKey)return;
    const sessionKey=state.selectedKey;state.processConfirmation={sessionKey,target:{...target}};
    const help='Confirm termination of the captured PID on its collecting server. macOS/Linux send SIGTERM; Windows terminates it. Children are not signaled and there is no escalation. Killing a harness can end its agent session. The collector rechecks birth identity and ownership; stale or inaccessible targets are refused.';
    showDetail(state,'Confirm process termination',{title:'Terminate process?',help,sections:[{id:'confirm',title:data.demo?'Confirmation · simulation':'Confirmation',rows:[{id:'process-cancel',text:'Cancel',help:'Enter cancels and returns to the saved reader. No signal is sent.',action:{type:'message'}},{id:'process-confirm',text:`Terminate PID ${target.pid} · ${target.name}`,role:'negative',help,action:{type:'terminate-process',sessionKey,processTarget:{...target}}}]},{id:'target',title:'Captured target',fields:[{label:'Process',value:target.name,role:'identity'},{label:'PID',value:String(target.pid),role:'identity'},{label:'Owner',value:target.owner,role:'identity'},{label:'Server',value:data.server?data.server.host+'/'+data.server.session:data.demo?'Demo · no OS signals':'Collecting server',role:'identity'},{label:'Identity',value:target.key,role:'identity'}]},{id:'effect',title:'Effect',text:data.demo?'Simulation only. No process will be signaled.':(target.isHarness?'This is the harness root. Terminating it can end the agent session.\n':'')+'Only this PID is targeted. macOS/Linux: SIGTERM. Windows: process termination. Children are not signaled. There is no automatic escalation.'}]});
    state.cursorId='process-cancel';return;
  }
  if(state.tab==='Notes'&&!state.notes?.editing&&!state.help&&state.detail===undefined){const move:Record<string,number>={up:-1,down:1,pageup:-screen.bodyHeight,pagedown:screen.bodyHeight};if(key in move){state.notesScroll=Math.max(0,(state.notesScroll??0)+move[key]!);return;}if(key==='home'||key==='end'){state.notesScroll=key==='home'?0:Number.MAX_SAFE_INTEGER;return;}}
  if(state.editingFilter){if(key==='enter'||key==='escape'){state.editingFilter=false;state.cursor=0;state.cursorId=undefined;}else if(key==='backspace')state.filter=[...state.filter].slice(0,-1).join('');else if(key.length===1)state.filter+=key;return;}
  if((key==='backspace'||key==='escape')&&!state.help&&state.detail===undefined&&!state.refSources&&!state.numberPrefix){const parent=inspectionParentKey(data,state);if(parent&&!state.notes?.editing){return{type:parent===state.boundSessionKey?'follow-bound':'select',sessionKey:parent};}if(key==='backspace')return;}
  if(key==='escape'){if(state.help)closeHelp(state);else closeDetail(state);state.numberPrefix='';state.notice=undefined;return;}
  if(key==='?'||key==='help'){if(state.help)closeHelp(state);else{state.helpReader={cursor:state.cursor,cursorId:state.cursorId,scroll:state.scroll};state.helpText=screen.rows[state.cursor]?.help??'Scroll to read recorded content; Escape returns to the previous entry.';if(state.boundSessionKey&&state.selectedKey!==state.boundSessionKey&&!state.pin)state.helpText+='\n\nYou are inspecting another agent. Escape closes this help; Shift+F then returns to following this panel’s bound agent.';state.readerSequence=(state.readerSequence??0)+1;state.helpViewId=state.readerSequence;state.help=true;state.cursor=0;state.cursorId=undefined;state.scroll=0;}return;}
  if(key==='q'||key==='ctrl+c')return {type:'quit'};
  if(key==='tab'||key==='shift+tab'){const order=orderedTabs(state),i=order.indexOf(state.tab);return changeTab(state,order[(i+(key==='tab'?1:order.length-1))%order.length]!);}
  if(state.help&&!['j','k','down','up','pageup','pagedown','home','end','g','G'].includes(key))return;
  if(key==='/'){state.editingFilter=true;if(state.selectedKey&&state.messageReaders.has(state.selectedKey))state.messageReaders.get(state.selectedKey)!.following=false;return;}
  if(key==='p'){state.pin=!state.pin;return {type:'pin'};}
  if(key==='u'){state.subtree=!state.subtree;return {type:'scope'};}
  if(key==='w'&&state.tab==='Agents'){state.view=state.view==='lineage'?'worktrees':'lineage';state.cursorId=undefined;state.cursor=0;return;}
  if(key===',')return {type:'settings'};
  if(key==='e')return {type:'export'};
  if(/^\d$/.test(key)&&state.tab==='Agents'){if(!state.numberPrefix)state.numberTargets=new Map(screen.numericTargets);state.numberPrefix=(state.numberPrefix+key).slice(0,8);return;}
  if(key==='enter'&&state.numberPrefix){const sessionKey=state.numberTargets.get(Number(state.numberPrefix));state.numberPrefix='';return sessionKey?{type:'select',sessionKey}:undefined;}
  if((key==='b'||key==='B')&&state.tab==='Refs'&&state.detail===undefined){const reader=state.refSources??state.pagedRefs.get(state.selectedKey??''),restart=key==='B'||reader?.stale===true;if(reader&&!reader.hasMore&&!restart)return;return{type:state.refSources?'ref-sources':'page-refs',sessionKey:state.selectedKey,id:state.refSources?.reference.id,referencePageCursor:restart?undefined:reader?.cursor,restart};}
  if((key==='b'||key==='pageup'&&state.cursor===0)&&state.tab==='Messages'&&state.detail===undefined&&!state.help){const session=data.sessions.find(s=>s.key===state.selectedKey);const beforeId=session?allMessages(session,state)[0]?.id:undefined;const reader=state.selectedKey?state.messageReaders.get(state.selectedKey):undefined;if(reader){reader.following=false;reader.anchorId=beforeId;}state.cursorId=beforeId;state.cursor=0;return {type:'page-messages',sessionKey:state.selectedKey,beforeId};}
  if(!state.help&&screen.sectionRegions){
    const current=screen.sectionRegions.find(region=>region.indices.includes(state.cursor))??screen.sectionRegions[0]!;
    if(key==='left'||key==='right'){
      const available=screen.sectionRegions.filter(region=>region.indices.length),at=available.indexOf(current),neighbors=available.filter(region=>region.height>0&&(key==='right'?region.x>current.x:region.x<current.x)).sort((a,b)=>Math.abs(a.y-current.y)-Math.abs(b.y-current.y)),next=neighbors[0]??available[(Math.max(0,at)+(key==='right'?1:available.length-1))%available.length];
      if(next){const saved=state.sectionReaders?.get(sectionReaderKey(state,next.id));state.cursor=next.indices.find(index=>screen.rows[index]?.id===saved?.cursorId)??next.indices[0]!;state.cursorId=screen.rows[state.cursor]?.id;resetEntryScroll(state,screen);}return;
    }
    if(key==='pagedown'||key==='pageup'){scrollRegion(state,current,(key==='pagedown'?1:-1)*Math.max(1,current.contentHeight),screen);return;}
    const moves:Record<string,number>={j:1,down:1,k:-1,up:-1};
    if(key in moves||['home','g','end','G'].includes(key)){
      const at=current.indices.indexOf(state.cursor),target=key==='home'||key==='g'?0:key==='end'||key==='G'?current.indices.length-1:at+moves[key]!;
      state.cursor=current.indices[Math.max(0,Math.min(target,current.indices.length-1))]??state.cursor;state.cursorId=screen.rows[state.cursor]?.id;
      resetEntryScroll(state,screen);
      if(current.id==='Retained messages'){const reader=state.messageReaders.get(state.selectedKey??'');if(reader){reader.following=state.cursor===current.indices.at(-1)&&!['home','g','up','k','pageup'].includes(key);if(reader.following)reader.newCount=0;}}return;
    }
  }
  if((key==='left'||key==='right')&&state.tab==='Overview'&&!state.detail&&!state.help){const current=screen.rowRegions?.find(region=>region.index===state.cursor);if(current){const candidates=screen.rowRegions?.filter(region=>key==='right'?region.x>current.x:region.x<current.x).sort((a,b)=>Math.abs(a.y-current.y)-Math.abs(b.y-current.y));if(candidates?.[0]){state.cursor=candidates[0].index;state.cursorId=screen.rows[state.cursor]?.id;}}return;}
  const moves:Record<string,number>={j:1,down:1,k:-1,up:-1,pagedown:screen.bodyHeight,pageup:-screen.bodyHeight};
  if(key in moves){state.cursor+=moves[key];state.cursorId=undefined;resetEntryScroll(state,screen);const reader=state.selectedKey?state.messageReaders.get(state.selectedKey):undefined;if(reader&&state.tab==='Messages'&&state.detail===undefined)reader.following=state.cursor>=screen.rows.length-1;if(reader?.following)reader.newCount=0;return;}
  if(key==='home'||key==='g'){resetEntryScroll(state,screen);state.cursor=0;state.cursorId=undefined;const reader=state.selectedKey?state.messageReaders.get(state.selectedKey):undefined;if(reader&&state.tab==='Messages')reader.following=false;return;}
  if(key==='end'||key==='G'){resetEntryScroll(state,screen);state.cursor=screen.rows.length-1;state.cursorId=undefined;const reader=state.selectedKey?state.messageReaders.get(state.selectedKey):undefined;if(reader&&state.tab==='Messages'&&state.detail===undefined){reader.following=true;reader.newCount=0;}return;}
  const row=screen.rows[state.cursor];if(!row)return;
  if(key==='f'&&state.tab==='Agents'&&state.detail===undefined){const session=data.sessions.find(s=>s.key===row.action?.sessionKey);if(session?.attachment)return {type:'focus',sessionKey:session.key};state.notice='This agent has no live Herdr pane';return;}
  if(key==='space'){
    if(state.detail!==undefined)return row.action?.type==='ref-sources'?row.action:undefined;
    if(state.tab==='Agents'){const session=data.sessions.find(s=>s.key===row.action?.sessionKey);if(session&&data.sessions.some(child=>child.parentKey===session.key)){state.collapsed.has(session.key)?state.collapsed.delete(session.key):state.collapsed.add(session.key);}else if(session){state.expanded.has(session.key)?state.expanded.delete(session.key):state.expanded.add(session.key);}}
    else if(state.tab==='Messages'){const id=row.action?.id??row.id;state.expanded.has(id)?state.expanded.delete(id):state.expanded.add(id);}
    else if(state.tab==='Processes'){const id=`process:${state.selectedKey}:${row.id}`;state.collapsed.has(id)?state.collapsed.delete(id):state.collapsed.add(id);}
    else if(state.tab==='Refs'){if(state.refSources)return row.action;const session=data.sessions.find(s=>s.key===state.selectedKey);const ref=session?visibleReferences(session,state).find(ref=>ref.id===row.id):undefined;if(ref)return{type:'ref-sources',sessionKey:state.selectedKey,id:ref.id};else showDetail(state,row.copy??row.text);}
    return;
  }
  if(key==='x'&&state.tab==='To-do')return {type:'toggle-todo',sessionKey:state.selectedKey,id:row.id};
  if(key==='y')return {type:'copy',text:row.copy??row.text};
  if(key==='s'&&row.sourceId)return {type:'source',sessionKey:state.selectedKey,id:row.sourceId,referenceCursor:row.action?.referenceCursor};
  if(key==='d'&&row.document)return {type:'message',document:row.document,text:documentText(row.document)};
  if(key==='enter'||key==='d'){if(row.action?.type==='tab'&&row.action.tab)return changeTab(state,row.action.tab);return row.action;}
}
