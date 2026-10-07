import {cellWidth,sanitize,truncate} from './text.ts';
import {styleSpans} from './theme.ts';
import type {ColorRole,TextSpan,ThemeName} from './theme.ts';
import {renderLayout,sectionReaderKey} from './layout.ts';
import type {LayoutSection} from './layout.ts';
import {createUiState} from './screen.ts';
import {renderNotes} from './notes.ts';
import type {DashboardData,DetailDocument,RenderedScreen,ScreenRow,Tab} from './types.ts';

export const inspectorPreviewTabs=['Overview','Notes','To-do','Git','Agents','Processes','Refs','Messages'] as const;
export const previewViews=[...inspectorPreviewTabs,'Notes editor','Sidebar','Help','Detail'] as const;
export type PreviewView=typeof previewViews[number];
export interface PreviewEntry {
  id:string;label:string;value?:string;help:string;detail?:string;target?:PreviewView;role?:ColorRole;display?:string;messageBand?:0|1;
}
interface DetailField {label:string;value:string;role?:ColorRole;}
interface Section {title:string;entries:PreviewEntry[];description?:string[];descriptionRole?:ColorRole;fields?:DetailField[];column?:0|1;}
export interface PreviewOptions {width?:number;height?:number;selected?:number;scroll?:number;sectionScroll?:Record<string,number>;freeScroll?:boolean;activeSection?:string;ascii?:boolean;theme?:ThemeName;entry?:PreviewEntry;}
export interface PreviewFrame {
  view:PreviewView;lines:string[];spans:TextSpan[][];entries:(PreviewEntry&{display:string})[];
  selectedLine?:number;bodyStart:number;bodyHeight:number;columns:1|2;scroll:number;footer:string;theme:ThemeName;
  positions:{entry:number;line:number;column:number;width:number;actionColumn?:number}[];
  terminalCursor?:{line:number;column:number};
  sectionScroll?:Record<string,number>;sectionRegions?:{id:string;line:number;column:number;width:number;height:number;contentHeight:number;total:number;scroll:number;entries:number[];}[];
}
const goal='Build reliable monitoring for local and remote harness sessions, with readable telemetry and safe installation.';
const note='# Session notes\n\n## Decisions\n- Run Prism on each remote server.\n- Keep visibility API work upstream.\n\n## Follow-up\nVerify the saved draft after reconnecting.';
const fact=(id:string,label:string,value:string,detail:string,help:string,role?:ColorRole):PreviewEntry=>({id,label,value,detail,help,role});
const link=(id:string,label:string,value:string,target:PreviewView,help:string,role?:ColorRole):PreviewEntry=>({id,label,value,target,help,role});
const usageDetail='Recorded usage\n\nInput: 42,180 tokens\nOutput: 6,210 tokens\nCache read: 30,000 tokens (subset of input)\nCache write: unavailable\nReasoning: unavailable\n\nCurrent context: 18,500 / 128,000 (14.5%)\nLast recorded turn: 4,230 tokens\nGeneration rate: unavailable\nCost: unavailable\n\nCoverage: retained provider counters.\nMissing values are unavailable, not zero.';
const gitDetail='Checkout\n\nBranch: feature/remote-monitor\nRepository: /work/herdr-prism\nCheckout: /work/trees/remote-monitor\nAdded lines: 128\nDeleted lines: 37\nUntracked files: 2\nConflicts: 0\nAhead: 3\nBehind: 0\nGit snapshot age: 2 seconds\n\nGit values belong to this exact checkout.';
const sections:Record<Exclude<PreviewView,'Help'|'Detail'>,Section[]>={
  Overview:[
    {title:'Work',entries:[
      fact('goal','Goal',goal,`Goal\n\n${goal}\n\nStatus: active\nSource: explicit goal record`,'An explicitly reported goal. Enter opens the full objective and its recorded source. Initial requests are kept separate.'),
      fact('task','Task','Review remote visibility', 'Delegated task\n\nReview remote visibility boundaries and document the upstream Herdr API dependency.','A delegated task is distinct from a goal. Enter opens its complete text.'),
      fact('turn','Timing','8m session · 23s turn','Session age: 8 minutes\nCurrent turn elapsed: 23 seconds\nHarness uptime: 8 minutes 12 seconds\nGeneration time: unavailable','Current-turn elapsed needs a sourced turn boundary. Harness uptime needs a verified harness process. Enter opens all recorded timings.'),
    ]},
    {title:'Resources',entries:[
      fact('cpu','CPU','124%  ▁▂▄▆▅█','CPU\n\nAggregate: 124%\n100% = one logical core.\nScope: self + verified owned jobs.\nHistory: sampled peaks; blank columns are gaps.\nThis aggregate may exceed 100%.','Sampled CPU of the selected scope. 100% means one core; history gaps are not interpolated. Enter opens readings and coverage.'),
      fact('memory','RSS sum','620 MiB  ▂▂▃▄▆█','Memory\n\nRSS sum: 620 MiB\nObserved peak: 710 MiB\nShared resident pages can be counted by more than one process.\nWindows reports working-set sum.','Resident-memory sum, not host memory percent. Shared pages can appear in several processes. Peak is the highest observed aggregate sample. Windows uses working-set sum. Enter opens the measurements and scope.'),
      link('processes','Processes','4/4 readable','Processes','Enter opens owned processes. The denominator includes verified unavailable processes; unreadable values are not measured zero.'),
    ]},
    {title:'Usage',entries:[
      fact('context','Context','14.5%  ▰▱▱▱▱▱▱▱',usageDetail,'Current-context occupancy is separate from lifetime consumption. A percent requires a measured numerator and compatible capacity. Enter opens exact counters.'),
      fact('tokens','Tokens','42.2k in · 6.2k out',usageDetail,'Recorded provider counters with retained coverage. Enter opens exact token, cache, reasoning, rate and cost facts.'),
    ]},
    {title:'Checkout',entries:[link('git','Git','+128 -37 · 0 conflicts','Git','Enter opens the exact checkout, branch and colored Git statistics. Untracked files are distinct from line additions.')]},
    {title:'Activity',entries:[
      link('agents','Agents','3 descendants','Agents','Enter opens the nested agent list. These are Prism targets; native Herdr focus indices are not claimed.'),
      link('messages','Messages','U12 A18 · 2 tools','Messages','Enter opens retained messages. Historical messages can be loaded explicitly; this summary is not a lifetime total.'),
      link('refs','Refs','8 targets · partial','Refs','Enter opens reference targets and their exact source messages. Partial coverage remains labeled.'),
      link('todo','To-do','2 pending · 1 checked','To-do','Enter opens reported requests and local checkmarks. A local checkmark does not change the agent transcript.'),
      link('notes','Notes','Saved 14:32','Notes','Enter opens private Markdown notes for this agent on the collecting server.'),
    ]},
  ],
  Agents:[{title:'Panel owner and sub-agents',description:['Only this agent’s recorded worker tree'],entries:[
    link('agent-root','▾ A1 Monitor','working','Overview','Panel owner. Enter inspects; f focuses a live pane; Space folds recorded children. ? explains the selected entry.'),
    link('agent-parser','  ▾ A2 Parser','working','Overview','Reported task: implement exact source cursors. Enter inspects Parser; d opens identity; Space folds its children.'),
    link('agent-source','    · A3 Source','waiting','Overview','Nested worker. Reported task: verify original reference records. Enter inspects; Shift+F returns to the panel owner.'),
    link('agent-test','  · A4 Linux tests','done · no pane','Overview','Completed worker. Enter inspects its retained evidence. No live pane is available for native focus.'),
  ]}],
  Processes:[{title:'Owned processes',description:['PID      Name        CPU     RSS', '4/4 readable · self + jobs'],entries:[
    fact('p1','4102 prism','68%    184M','Process: prism-harness\nPID: 4102\nPPID: 4000\nCPU: 68%\nRSS: 184 MiB\nThreads: 12\nOwner: Monitor\nBirth identity: verified\n\nK opens a confirmation in live process views. Demo actions send no OS signal.','Enter opens the full process name, identity, owner, threads and measurements. Space folds process children.'),
    fact('p2','  4108 node','31%    162M','Process: node-worker\nPID: 4108\nPPID: 4102\nCPU: 31%\nRSS: 162 MiB\nOwner: Monitor','Child of the verified harness process. Enter opens full identity and measurement availability.'),
    fact('p3','  4110 test','25%    274M','Process: test-worker\nPID: 4110\nPPID: 4102\nCPU: 25%\nRSS: 274 MiB','Enter opens complete process facts. CPU is normalized to one logical core, not the entire machine.'),
    fact('p4','  4112 git',' 0%      0M','Process: git\nPID: 4112\nCPU: measured zero\nRSS: measured zero','Zero is a measured value. Enter opens source and sample availability.'),
  ]},{title:'Scope',entries:[fact('process-scope','Coverage','CPU 4/4 · memory 4/4','Scope: selected agent + owned jobs\nCPU: 4/4 readable\nMemory: 4/4 readable\nAggregate CPU: 124%\nAggregate RSS: 620 MiB\n\nIf any required process is unavailable, the aggregate CPU is unavailable.','Partial process samples do not establish a complete aggregate. Press u to choose subtree scope; Enter opens ownership and coverage.')]}],
  Messages:[{title:'Retained messages',entries:[
    fact('message-user','User · 3m ago','Review remote session support','User\n\nReview remote session support, preserving per-server installation and showing cached metrics honestly.','Enter opens the entire message. s opens its source when available, y copies the full text, and b loads older history.'),
    fact('message-assistant','Assistant · 2m','Collector runs on each server','Assistant\n\nThe collector runs on each remote Herdr server. The local client views its data. Background-machine visibility and the last viewer disconnect require an upstream host API.','Enter opens full text and recorded tools. Counts cover retained messages; new messages do not move a scrollback reader.'),
    fact('message-tool','Tool · 90s ago','exec_command · tests passed','Tool result\n\nexec_command\nTargeted tests passed: 51\nFailures: 0\n\nThe exact source record remains available.','Enter opens full tool summary and result. A tool result is distinct from an assistant message.','positive'),
    fact('message-agent','Agent · 1m ago','Parser → Monitor: ready','Inter-agent message\n\nAuthor: Parser\nRecipient: Monitor\nExact source cursors are ready for review.','Messages between agents retain author and recipient. Their text does not establish a request to the user.'),
  ]},{title:'Tool activity',entries:Array.from({length:8},(_,i)=>fact(`activity-tool-${i}`,'done · exec',`Tests passed · run ${i+1}`,`Tool result\n\nexec\nTests passed: ${i+1}\nEdited paths: /work/result-${i+1}.ts`,'Enter opens the complete tool result. Left/right switches panels; arrows and mouse wheels scroll only the active or hovered panel.','secondary'))}],
  Refs:[{title:'Reference targets',description:['8 targets · partial source history'],entries:[
    fact('ref-session','✎ session.ts','src/providers','Target\n\n/work/herdr-prism/src/providers/session.ts:184\nEdited: yes\nSources: 3 mentions\n\nEnter on the live target opens the file. Space opens mention history.','Enter opens this reference target; Space opens its mentions, s the exact source message, and y copies the full target path.'),
    fact('ref-doc','visibility-api.md','docs','Target\n\n/work/herdr-prism/docs/remote-visibility-api.md\nEdited: no\nSource message: assistant-18','Long paths show a meaningful filename and location. Full paths remain available in details and copy. Enter opens the target.'),
    fact('ref-missing','? old-sampler.ts','src/process','Missing target\n\n/work/herdr-prism/src/process/old-sampler.ts\nTarget is no longer present.\nThe recorded reference and its source remain available.','The ? prefix means the file was not found; it is independent of the ? help key. Enter reports the missing target, Space opens mention sources.','warning'),
    link('older-refs','Older targets','Load another page','Refs','Enter or b loads older reference targets. Exact file/offset/hash cursors preserve historical source routing.'),
  ]}],
  'To-do':[{title:'Reported requests',description:['2 pending · list reported 12s ago'],entries:[
    fact('todo-review','[ ] Review plan','first seen 3m ago','Reported request\n\nReview the complete remote-session plan and verify the API dependency boundary before claiming visibility guarantees.\n\nFirst source: assistant-12\nLatest repeated source: assistant-18\nLocally checked: no','Enter opens the full request. s opens its source; x checks locally; y copies one inline command or the complete request.'),
    fact('todo-tests','[ ] Run Linux tests','repeated · 1m ago','Reported request\n\nRun `npm test` in the Linux fixture after rebasing.\n\nRepeated request: yes\nLocally checked: no','Enter opens the complete request. Repeated mentions share one local check state; they are not multiple independent tasks.'),
    fact('todo-done','[x] Install shortcut','locally checked','Reported request\n\nVerify Ctrl+B then i opens Prism in the live Herdr session.\n\nLocally checked: yes\nThe agent transcript was not edited.','Enter opens request facts. x reopens this local checkmark. Local completion does not claim the harness has completed a task.','positive'),
  ]}],
  Git:[{title:'Checkout',entries:[
    fact('git-branch','Branch','feature/remote-monitor',gitDetail,'Enter opens the full checkout identity. Same branch names on different worktrees are not merged.'),
    fact('git-diff','Lines','+128  -37',gitDetail,'Added/deleted line statistics from the exact checkout. Enter opens all Git fields.'),
    fact('git-untracked','Untracked','2 files',gitDetail,'Untracked file counts are independent of line additions. Enter opens the recorded Git snapshot.'),
    fact('git-conflicts','Conflicts','0',gitDetail,'Zero conflicts is a measured value. An unavailable Git snapshot is shown as unavailable, not zero.','positive'),
    fact('git-tracking','Upstream','↑3 ahead · ↓0 behind',gitDetail,'Ahead/behind is reported only for a compatible upstream. Enter opens the complete snapshot.'),
    fact('git-root','Worktree','remote-monitor',gitDetail,'Full repository family, checkout path, branch state and snapshot age are available on Enter.'),
  ]},{title:'Snapshot',entries:[fact('git-fresh','Age','2s · measured',gitDetail,'This is a cached Git snapshot, not an ongoing promise of a clean checkout. Heavy Git updates run only for the open selected session.')]}],
  Notes:[{title:'Private Markdown',description:['Saved 14:32 · this agent · local server'],entries:[
    {...link('notes-document','Edit notes','Session decisions and follow-up','Notes editor','Enter edits Markdown. Autosave after 500 ms; Ctrl+S flushes; Escape returns to reading. While editing, printable navigation keys insert text and follow is held.'),detail:note},
  ],},{title:'Document',description:note.split('\n'),entries:[]}],
  'Notes editor':[{title:'Markdown editor',description:['Editing · follow held · autosave 500ms','Draft belongs to Monitor on local/main','',...note.split('\n'),'','Cursor: line 9, column 1'],entries:[]}],
  Sidebar:[{title:'Native Agents · compact preset',description:['● codex Monitor','  Goal: Reliable session monitoring','  CPU 124% · RSS 620M · 3 agents','  local/project remote-monitor +128 -37'],entries:[]},
    {title:'Next agent · background',description:['● codex Parser','  Task: Exact source cursors','  CPU — · RSS — · cached','  local/project parser'],entries:[]}],
};

const pad=(text:string,width:number)=>text+' '.repeat(Math.max(0,width-cellWidth(text)));
/** Summaries stop at whole words; exact original text stays in the detail. */
function summarize(value:string,width:number):string{
  const text=sanitize(value).replace(/[\r\n\t]/g,' ').trim();if(cellWidth(text)<=width)return text;
  let out='';for(const word of text.split(' ')){const next=out?out+' '+word:word;if(cellWidth(next)>width)break;out=next;}
  return out||truncate(text,width);
}
function compactEntry(entry:PreviewEntry,width:number):string{
  const arrow=entry.target||entry.detail?' →':'';
  const label=entry.label,value=entry.value??'';
  // Reserve the action indicator before fitting either part of the summary.
  const room=Math.max(1,width-cellWidth(arrow));
  if(/^p\d+$/.test(entry.id)){
    const [cpu='',memory='']=value.trim().split(/\s+/);
    const nameWidth=Math.min(20,Math.max(1,room-12));
    return pad(summarize(label,nameWidth),nameWidth)+pad(cpu.padStart(4)+' '+memory.padStart(6),room-nameWidth)+arrow;
  }
  const prefix=cellWidth(label)<11?pad(label,11):label+' · ';
  const text=!value?summarize(label,room):cellWidth(prefix)<room?prefix+summarize(value,room-cellWidth(prefix)):summarize(label,room);
  return pad(text,room)+arrow;
}
const accountDetail='Account / limits\n\nPlan: Pro\nScope: Account-wide, shared by sessions and devices\nFive-hour used: 12.5%\nWeekly used: 89.2%\nNext reset: 1h 0m\nCredits: 38672.413016\nReported: 10s ago\nSource: Selected session provider observation';
sections.Overview.push({title:'Account / limits',column:0,entries:[
 fact('account-plan','Plan','Pro · codex',accountDetail,'Provider-reported plan for the selected session. Account quotas are shared by sessions and devices; they are separate from conversation token totals. Enter opens exact values.' ,'identity'),
 fact('account-window-primary','5h','12.5% ▰▱▱▱▱▱ · 1h',accountDetail,'Recorded account-wide quota usage and next reset. Data older than 15 minutes and expired quota windows are hidden. ? explains limits; Enter opens recorded provenance.','quantity'),
 fact('account-window-secondary','7d','89.2% ▰▰▰▰▰▱ · 6d',accountDetail,'Provider-reported weekly window. Session and descendant usage is never added to this percentage. Enter opens all exact quota facts.','warning'),
 fact('account-credits','Credits','38.7K',accountDetail,'Reported credit balance, not an invoice or this session’s cost. Enter shows the exact decimal value.','quantity'),
]});
for(const [i,entry]of sections.Messages[0]!.entries.entries())entry.messageBand=i%2 as 0|1;
/** Detail presentation uses the fixture's facts, keeping metric explanations in help. */
function structuredDetail(entry:PreviewEntry):Section[]|undefined{
  const text=entry.detail??'';
  const values=new Map<string,string>();
  for(const line of text.split('\n')){const field=/^([A-Za-z][A-Za-z -]*):\s+(.+)$/.exec(line);if(field)values.set(field[1]!,field[2]!);}
  const section=(title:string,fields:DetailField[],column:0|1=0):Section=>({title,entries:[],fields,column});
  const known=(keys:[string,string,ColorRole?][]):DetailField[]=>keys.flatMap(([key,label,role])=>values.has(key)?[{label,value:values.get(key)!,role}]:[]);
  if(entry.id.startsWith('account-'))return[section('Account scope',known([['Plan','Plan','identity'],['Scope','Scope'],['Source','Source','identity']])),section('Quota and credits',known([['Five-hour used','5h used','quantity'],['Weekly used','7d used','warning'],['Next reset','Reset in','duration'],['Credits','Credits','quantity'],['Reported','Reported','duration']]),1)];
  if(entry.id==='memory')return[
    section('Memory',[
      ...known([['RSS sum','Current','quantity'],['Observed peak','Peak','quantity']]),
      {label:'History',value:'▂▂▃▄▆█',role:'quantity'},
    ]),
    section('Sample scope',[{label:'Metric',value:'RSS sum',role:'identity'},{label:'Includes',value:'Selected agent + owned jobs'}],1),
  ];
  if(entry.id==='cpu')return[
    section('CPU',known([['Aggregate','Current','quantity']])),
    section('Sample scope',known([['Scope','Includes']]),1),
    section('History',[{label:'Samples',value:'▁▂▄▆▅█',role:'quantity'}]),
  ];
  if(entry.id==='context'||entry.id==='tokens'){
    const context=/^([\d,]+) \/ ([\d,]+) \(([\d.]+)%\)$/.exec(values.get('Current context')??'');
    const cache=values.get('Cache read')?.replace(/\s+\(.+\)$/,'');
    return[
      section('Recorded tokens',[
        ...known([['Input','Input','quantity'],['Output','Output','quantity']]),
        ...(cache?[{label:'Cache read',value:cache,role:'quantity' as const}]:[]),
        ...known([['Cache write','Cache write','quantity'],['Reasoning','Reasoning','quantity']]),
        ...(values.get('Cache read')?.includes('subset')?[{label:'Cache mode',value:'Subset of input',role:'identity' as const}]:[]),
      ]),
      section('Context',context?[
        {label:'Used',value:context[1]+' tokens',role:'quantity'},
        {label:'Capacity',value:context[2]+' tokens',role:'quantity'},
        {label:'Occupancy',value:context[3]+'%',role:'quantity'},
        {label:'Meter',value:'▰▱▱▱▱▱▱▱',role:'quantity'},
      ]:[],1),
      section('Turn',known([['Last recorded turn','Last turn','quantity']]),1),
      section('Rates and cost',known([['Generation rate','Generation','quantity'],['Cost','Cost','quantity']]),1),
      section('Provenance',known([['Coverage','Coverage']])),
    ].filter(item=>item.fields!.length);
  }
  if(entry.id.startsWith('git-'))return[
    section('Checkout identity',known([['Branch','Branch','identity'],['Repository','Repository','path'],['Checkout','Worktree','path']])),
    section('Changes',known([['Added lines','Added','positive'],['Deleted lines','Deleted','negative'],['Untracked files','Untracked','quantity'],['Conflicts','Conflicts']]).map(field=>({...field,value:field.label==='Added'?`+${field.value} lines`:field.label==='Deleted'?`-${field.value} lines`:field.label==='Untracked'?field.value+' files':field.value,role:field.label==='Conflicts'?(field.value==='0'?'positive':'negative'):field.role})),1),
    section('Tracking',known([['Ahead','Ahead','quantity'],['Behind','Behind','quantity']]).map(field=>({...field,value:field.value+' commits'})),1),
    section('Snapshot',known([['Git snapshot age','Age','duration']])),
  ];
  if(entry.id==='turn')return[
    section('Session',known([['Session age','Age','duration'],['Harness uptime','Uptime','duration']])),
    section('Turn',known([['Current turn elapsed','Elapsed','duration'],['Generation time','Generation','duration']]),1),
  ];
  if(entry.id==='agent-cached')return[
    section('Cached resources',known([['CPU','CPU','quantity'],['RSS sum','RSS','quantity']])),
    section('Observation',known([['Sample','Age','duration']]),1),
  ];
  if(/^p\d+$/.test(entry.id))return[
    section('Identity',known([['Process','Name','identity'],['PID','PID','identity'],['PPID','PPID','identity'],['Birth identity','Birth']])),
    section('Resources',known([['CPU','CPU','quantity'],['RSS','RSS','quantity'],['Threads','Threads','quantity'],['Availability','Status','warning']]),1),
    section('Ownership',known([['Owner','Agent','identity']])),
  ].filter(item=>item.fields!.length);
  if(entry.id==='process-scope')return[
    section('Selected scope',known([['Scope','Includes','identity']])),
    section('Readable samples',known([['CPU','CPU','positive'],['Memory','Memory','positive']]),1),
    section('Aggregate readings',known([['Aggregate CPU','CPU','quantity'],['Aggregate RSS','RSS','quantity']]),1),
  ];
  if(entry.id.startsWith('ref-')){
    const target=text.split('\n').find(line=>/^(?:\/|[A-Za-z]:[\\/])/.test(line));
    if(!target)return;
    const match=/^(.*?)(?::(\d+))?$/.exec(target)!;const fullPath=match[1]!,name=fullPath.split(/[\\/]/).at(-1)!;
    const missing=entry.id==='ref-missing';
    return[
      section('Reference target',[
        {label:'Name',value:name,role:'identity'},
        {label:'Path',value:fullPath,role:'path'},
        ...(match[2]?[{label:'Line',value:match[2],role:'quantity' as const}]:[]),
      ]),
      section('Recorded facts',[
        {label:'State',value:missing?'Missing target':'Recorded target',role:missing?'warning':'text'},
        ...known([['Edited','Edited'],['Sources','Sources','accent'],['Source message','Message','accent']]),
      ],1),
    ];
  }
  if(values.size){
    const fields=[...values].map(([label,value]):DetailField=>({label,value,role:/^(?:status|state|locally checked)$/i.test(label)?/^(?:active|working|done|yes)$/i.test(value)?'positive':/^(?:waiting|blocked|unknown)$/i.test(value)?'warning':'text':/source|author|recipient|parent|provider/i.test(label)?'identity':/checkout|repository|path/i.test(label)?'path':/^\d/.test(value)?'quantity':undefined}));
    const narrative=text.split('\n').filter(line=>!/^([A-Za-z][A-Za-z -]*):\s+(.+)$/.test(line));
    return [{title:entry.label,entries:[],description:narrative,descriptionRole:'text'},section('Recorded facts',fields,1)];
  }
}
/** The fixtures supply content; the live renderer owns all geometry and scrolling. */
export function renderPreview(view:PreviewView,options:PreviewOptions={}):PreviewFrame{
  const width=Math.max(26,Math.floor(options.width??50)),height=Math.max(10,Math.floor(options.height??34));
  const theme=options.theme??'dark',state=createUiState(),detailId=options.entry?.id??'';
  const detailContext:Tab=detailId.startsWith('ref-')?'Refs':detailId==='process-scope'||/^p\d+$/.test(detailId)?'Processes':detailId.startsWith('git-')?'Git':detailId.startsWith('agent-')?'Agents':detailId.startsWith('message-')?'Messages':detailId.startsWith('todo-')?'To-do':'Overview';
  state.tab=view==='Notes editor'?'Notes':view==='Detail'||view==='Help'?detailContext:inspectorPreviewTabs.includes(view as any)?view as Tab:'Overview';
  state.tabOrder=[...inspectorPreviewTabs];state.selectedKey='preview-monitor';state.theme=theme;state.ascii=Boolean(options.ascii);state.monochrome=theme==='mono';state.scroll=options.scroll??0;
  state.notice='DESIGN ONLY · synthetic data';
  const data:DashboardData={sessions:[{key:state.selectedKey,depth:0,children:[],evidence:{id:'Monitor',title:'Monitor',provider:'codex',model:'demo-model',state:'working',messages:[],tools:[],usage:[],goals:[],availability:'known'}}],updatedAt:0,stale:false,diagnostics:[],demo:true,server:{id:'preview-server',host:'local',session:'main'}};
  const entries:PreviewFrame['entries']=[],entryIndices=new Map<string,number>();
  const processPreview=view==='Detail'&&/^p\d+$/.test(detailId);
  let document:DetailDocument|undefined,items:Section[];
  if(view==='Help'||view==='Detail'){
    const entry=options.entry??sections.Overview[0]!.entries[0]!;
    const title=(view==='Help'?'Help':'Detail')+' · '+entry.label;
    const text=view==='Help'?`${entry.help}\n\nEnter opens ${entry.target??'full content'}.\n? shows this entry's help.\nEscape returns to your previous selection.`:entry.detail??`${entry.label}\n\n${entry.value??''}\n\nDestination: ${entry.target??'none'}`;
    items=view==='Detail'?structuredDetail(entry)??[{title,description:text.split('\n'),descriptionRole:'text',entries:[]}]:[{title,description:text.split('\n'),descriptionRole:'text',entries:[]}];
    document={title,sections:[],help:entry.help,...(processPreview?{processTarget:{key:entry.id,owner:state.selectedKey,pid:Number(entry.id.slice(1)),name:entry.label}}:{})};
    state.detail=text;state.detailDocument=document;state.help=view==='Help';
    if(processPreview)items=[...items,{title:'Output',description:['[DEMO] Shared harness terminal',...Array.from({length:40},(_,i)=>`Build step ${i+1}: retained output`)],descriptionRole:'text',entries:[]}];
  }else if(view==='Overview'){
    const fixture=sections.Overview;
    items=[fixture[1]!,fixture[2]!,...fixture.filter(section=>section.title==='Account / limits'),...([fixture[0]!,fixture[3]!,fixture[4]!].map(section=>({...section,column:1 as const})))];
    // Narrow layouts retain the familiar top-to-bottom order.
    if(width<80)items=fixture;
  }else items=sections[view];
  const two=width>=80&&items.some(section=>section.column===1)&&items.some(section=>section.column!==1);
  const layout:LayoutSection[]=items.map(section=>{
    const rowWidth=two?Math.floor((width-2)/2):width;
    const rows:ScreenRow[]=section.entries.map(entry=>{
      entryIndices.set(entry.id,entries.length);entries.push({...entry,display:compactEntry(entry,rowWidth-4)});
      const row:ScreenRow={id:entry.id,section:section.title,text:[entry.label,entry.value].filter(Boolean).join(' · '),label:entry.label,value:entry.value,help:entry.help,role:entry.role,...(entry.target||entry.detail?{action:{type:'message',text:entry.detail??entry.value??entry.label}}:{})};
      if(view==='Agents'){row.label=undefined;row.value=undefined;row.role='identity';if(entry.id==='agent-parser')row.continuations=[{text:'    Task: Implement exact source cursors',role:'secondary'}];}
      if(entry.id==='cpu')row.value='124%     ▁▂▄▆▅█';
      if(entry.id==='memory'){row.value='620 MiB  ▂▂▃▄▆█';row.gapBefore=1;}
      if(view==='Messages'&&section.title==='Retained messages')row.continuations=[{text:entry.detail?.split('\n\n').slice(1).join('\n\n')??entry.value??'',role:entry.role??'text'}];
      return row;
    });
    return {id:processPreview&&section.title==='Output'?'output':section.title,title:section.title,rows,column:section.column,fields:section.fields,description:section.descriptionRole==='text'?undefined:section.description,text:section.descriptionRole==='text'?section.description?.join('\n'):undefined,viewport:true};
  });
  const selected=Math.max(0,Math.min(options.selected??0,entries.length-1));state.cursor=document?Math.max(0,options.scroll??0):selected;state.cursorId=entries[selected]?.id;
  state.sectionReaders=new Map(layout.map((section,index)=>[sectionReaderKey(state,section.id),{cursor:state.cursor,cursorId:state.cursorId,freeScroll:options.freeScroll,scroll:options.sectionScroll?.[section.id]??(section.rows.some(row=>row.id===state.cursorId)||document&&index===0?options.scroll??0:0)}]));
  // Process facts and output receive their runtime panel IDs during layout.
  if(processPreview)for(const id of ['Process facts','Output'])state.sectionReaders.set(sectionReaderKey(state,id),{cursor:0,freeScroll:options.freeScroll,scroll:options.sectionScroll?.[id]??options.scroll??0});
  if(options.activeSection&&!entries.length){const part=layout.find(section=>section.id===options.activeSection||processPreview&&(options.activeSection==='Output'?section.id==='output':options.activeSection==='Process facts'&&section.id!=='output'));if(part)state.cursorId=part.rows[0]?.id??(part.fields?.length?`${part.id}:field:0`:`${part.id}:text:0`);}
  let rendered:RenderedScreen;
  if(view==='Notes'||view==='Notes editor'){
    state.notes={sessionKey:state.selectedKey,title:'Monitor',text:note,cursor:note.length,editing:view==='Notes editor',status:'saved'};state.notesScroll=options.scroll??0;state.notesFreeScroll=options.freeScroll;
    rendered=renderNotes(data,state,width,height,0);
    if(view==='Notes editor')entries.length=0;
    else{
      const source=sections.Notes[0]!.entries[0]!;entries.splice(0,entries.length,{...source,display:rendered.rowRegions?.[0]?.display??source.label});entryIndices.clear();entryIndices.set('notes-edit',0);
    }
  }else rendered=renderLayout(data,state,layout,width,height,0,new Map(),document,view==='Messages'||processPreview?6:1);
  const spans=rendered.spans!,positions:PreviewFrame['positions']=[];
  for(const region of rendered.rowRegions??[]){
    const row=rendered.rows[region.index]!,entry=entryIndices.get(row.id);if(entry===undefined)continue;
    positions.push({entry,line:region.y-1,column:region.x-1,width:region.width,actionColumn:region.actionX===undefined?undefined:region.actionX-1});
    if(region.actionX!==undefined||!positions.slice(0,-1).some(position=>position.entry===entry))entries[entry]!.display=region.display;
  }
  const sectionScroll:Record<string,number>={};
  const sectionRegions=rendered.sectionRegions?.map(region=>{sectionScroll[region.id]=region.scroll;return{id:region.id,line:region.y-1,column:region.x-1,width:region.width,height:region.height,contentHeight:region.contentHeight,total:region.total,scroll:region.scroll,entries:[...new Set(region.indices.flatMap(index=>{const entry=entryIndices.get(rendered.rows[index]?.id??'');return entry===undefined?[]:[entry];}))]};});
  const footer=processPreview?'←→ panel · ↑↓ scroll · r refresh · Esc · ? help':view==='Help'||view==='Detail'?'↑↓ scroll · Esc back · ? help':view==='Agents'?'Enter inspect · f focus · ? help':view==='Messages'?'←→ panel · ↑↓ scroll · Enter · ? help':view==='Notes editor'?'Ctrl+S save · Esc read · text inserts':view==='Sidebar'?'Ctrl+B i opens Prism · ? help in Prism':view==='Notes'?'Enter edit · Ctrl+S save · ? help':'Enter open · Tab views · ? help';
  return {view,lines:rendered.lines.map(line=>line.trimEnd()),spans,entries,selectedLine:rendered.selectedLine,bodyStart:rendered.bodyStart,bodyHeight:rendered.bodyHeight,columns:sectionRegions?.some(region=>region.height>0&&region.column>0)?2:1,scroll:state.scroll,footer,theme,positions,sectionScroll:sectionRegions?sectionScroll:undefined,sectionRegions,terminalCursor:rendered.terminalCursor};
}
export function formatPreview(frame:PreviewFrame,options:{color?:boolean;depth?:4|8|24}={}):string{
  return frame.spans.map(line=>styleSpans(line,{theme:frame.theme,...options})).join('\n')+'\n';
}
